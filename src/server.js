// Server version: 1.0.0 - Deploy trigger
// Log inicial para debug - DEVE aparecer primeiro
process.stdout.write('SERVER: Starting...\n');
process.stderr.write('SERVER: Starting (stderr)\n');
console.log('SERVER: Node version:', process.version);
console.log('SERVER: CWD:', process.cwd());
console.log('SERVER: PORT:', process.env.PORT || 'not set');

import "dotenv/config";

console.log('✅ dotenv configurado');

import express from "express";

import cors from "cors";

import path from "path";

import axios from "axios";

import { fileURLToPath } from "url";

import pLimit from "p-limit";

console.log('✅ Dependências básicas importadas');

// Import direto do Puppeteer (não lazy) - mais confiável
import { launchBrowser, scrapeAmazonSite } from "./scrapers/amazonPuppeteer.js";
console.log('✅ Scraper importado com sucesso');



const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

console.log('✅ Paths configurados');

const app = express();

app.use(cors());

app.use(express.static(path.join(__dirname, "..", "public")));

console.log('✅ Express configurado');



const PORT = process.env.PORT || 10000;

const cache = new Map(); // Cache para armazenar resultados

// Endpoint para limpar cache (útil para debug)
app.get("/clear-cache", (req, res) => {
  cache.clear();
  res.json({ message: "Cache limpo" });
});

// Configuração de afiliados Amazon (substitua pelos seus IDs reais)
const AFFILIATE_TAGS = {
  'es': process.env.AMAZON_AFFILIATE_ES || 'dogshoppt-21',
  'fr': process.env.AMAZON_AFFILIATE_FR || 'dogshoppt01-21',
  'de': process.env.AMAZON_AFFILIATE_DE || 'dogshoppt0e-21',
  'it': process.env.AMAZON_AFFILIATE_IT || 'dogshoppt0d-21',
  'uk': process.env.AMAZON_AFFILIATE_UK || 'dogshoppt00-21'
};

const SITES = [

  { country:"🇪🇸 Spain",   domain:"amazon.es",   currency:"EUR", tag: AFFILIATE_TAGS.es },

  { country:"🇫🇷 France",  domain:"amazon.fr",   currency:"EUR", tag: AFFILIATE_TAGS.fr },

  { country:"🇩🇪 Germany", domain:"amazon.de",   currency:"EUR", tag: AFFILIATE_TAGS.de },

  { country:"🇮🇹 Italy",   domain:"amazon.it",   currency:"EUR", tag: AFFILIATE_TAGS.it },

  { country:"🇬🇧 UK",      domain:"amazon.co.uk",currency:"GBP", tag: AFFILIATE_TAGS.uk }

];

/** Adiciona tag de afiliado ao link Amazon */
function addAffiliateTag(url, tag) {
  if (!tag || tag.includes('your-tag')) return url; // Não adiciona se não configurado
  
  try {
    const urlObj = new URL(url);
    
    // Remove tags antigas se existirem
    urlObj.searchParams.delete('tag');
    
    // Adiciona a nova tag
    urlObj.searchParams.set('tag', tag);
    
    return urlObj.toString();
  } catch {
    return url;
  }
}



/** Agrupa produtos similares (mesmo modelo base) */
function groupSimilarProducts(results) {
  const groups = new Map();
  
  for (const result of results) {
    // Extrai modelo base do título (remove variações de cor, memória, etc)
    const baseModel = extractBaseModel(result.title);
    const key = baseModel.toLowerCase().trim();
    
    if (!groups.has(key)) {
      groups.set(key, {
        baseModel: baseModel,
        products: [],
        bestPrice: Infinity,
        bestPriceIndex: -1
      });
    }
    
    const group = groups.get(key);
    group.products.push(result);
    
    // Atualiza melhor preço
    if (result.priceEUR < group.bestPrice) {
      group.bestPrice = result.priceEUR;
      group.bestPriceIndex = group.products.length - 1;
    }
  }
  
  // Converte Map para Array e marca o melhor preço
  return Array.from(groups.values()).map(group => {
    if (group.bestPriceIndex >= 0) {
      group.products[group.bestPriceIndex].isBestPrice = true;
    }
    // Ordena produtos dentro do grupo por preço
    group.products.sort((a, b) => a.priceEUR - b.priceEUR);
    return group;
  });
}

/** Extrai modelo base do título (remove cores, memórias específicas) */
function extractBaseModel(title) {
  if (!title) return 'Unknown';
  
  // Remove padrões comuns de variações
  let model = title
    .replace(/\s*\([^)]*\)/g, '') // Remove parênteses
    .replace(/\s*\[[^\]]*\]/g, '') // Remove colchetes
    .trim();
  
  // Tenta extrair modelo principal (ex: "iPhone 16", "MacBook Pro 14")
  const modelPatterns = [
    /(iPhone\s+\d+[a-z]?)/i,
    /(iPad\s+\w+)/i,
    /(MacBook\s+\w+)/i,
    /(AirPods\s+\w+)/i,
    /(PlayStation\s+\d+)/i,
    /(Nintendo\s+Switch)/i,
    /(Samsung\s+Galaxy\s+\w+)/i
  ];
  
  for (const pattern of modelPatterns) {
    const match = title.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  // Se não encontrou padrão, pega primeiras palavras (marca + modelo)
  const words = model.split(/\s+/);
  if (words.length > 3) {
    return words.slice(0, 3).join(' ');
  }
  
  return model;
}

/** conversão para EUR usando exchangerate.host */

async function toEUR(amount, from){

  if(from==="EUR") return amount;

  try{

    const r = await axios.get(`https://api.exchangerate.host/convert`, {

      params:{ from, to:"EUR", amount }

    });

    return Number(r.data?.result) || amount;

  }catch{

    return amount;

  }

}

/** Função que executa o scraping */
async function runScrape(q) {
  console.log(`🚀 Iniciando scraping para: "${q}"`);
  
  let browser;
  try {
    console.log('🌐 Chamando launchBrowser()...');
    const browserStartTime = Date.now();
    
    browser = await Promise.race([
      launchBrowser(),
      new Promise((_, reject) => 
        setTimeout(() => {
          const elapsed = Date.now() - browserStartTime;
          reject(new Error(`Puppeteer timeout após ${elapsed}ms`));
        }, 45000) // 45 segundos
      )
    ]);
    
    const browserInitTime = Date.now() - browserStartTime;
    console.log(`✅ Browser iniciado em ${browserInitTime}ms`);
    
    const limit = pLimit(5); // Aumentar concorrência para 5 (um por site) para ser mais rápido

    console.log(`🌍 Iniciando scraping em ${SITES.length} sites...`);
    const tasks = SITES.map(site => limit(async () => {
      console.log(`🔍 Scraping ${site.country} (${site.domain})...`);
      const startTime = Date.now();
      try {
        // Timeout de 10s por site para garantir que não demore muito
        const result = await Promise.race([
          scrapeAmazonSite(site, q, browser),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout após 10s`)), 10000)
          )
        ]);
        const elapsed = Date.now() - startTime;
        console.log(`✅ ${site.country} sucesso em ${elapsed}ms`);
        return result;
      } catch (err) {
        const elapsed = Date.now() - startTime;
        console.warn(`⚠️ ${site.country} falhou após ${elapsed}ms: ${err.message}`);
        return null;
      }
    }));

    const raw = (await Promise.all(tasks)).filter(Boolean);
    console.log(`📊 ${raw.length} de ${SITES.length} sites retornaram resultados`);
    
    if (raw.length === 0) {
      console.warn('⚠️ NENHUM resultado encontrado de nenhum site!');
      console.warn('⚠️ Isso pode indicar:');
      console.warn('   - Amazon mudou os seletores');
      console.warn('   - Todos os sites retornaram erro');
      console.warn('   - Produto não encontrado em nenhum site');
      return [];
    }
    
    console.log(`📦 Primeiros resultados brutos:`, raw.slice(0, 2).map(r => ({
      country: r.country,
      domain: r.domain,
      title: r.title?.substring(0, 30),
      price: r.price,
      hasLink: !!r.link
    })));

    for (const r of raw) {
      try {
        r.priceEUR = await toEUR(r.price, r.currency);
        
        // Adiciona tag de afiliado ao link
        const site = SITES.find(s => s.domain === r.domain);
        if (site && site.tag) {
          r.link = addAffiliateTag(r.link, site.tag);
        }
      } catch (err) {
        console.warn(`⚠️ Erro ao processar resultado de ${r.domain}:`, err.message);
      }
    }

    const validResults = raw.filter(r => r.priceEUR && r.priceEUR > 0 && r.link);
    console.log(`✅ ${validResults.length} resultados válidos após processamento`);
    
    // Agrupa produtos similares (mesmo modelo base)
    console.log(`🔄 Agrupando ${validResults.length} produtos...`);
    const grouped = groupSimilarProducts(validResults);
    console.log(`📦 ${grouped.length} grupos de produtos similares criados`);
    
    // Valida estrutura dos grupos
    if (grouped.length > 0) {
      console.log(`✅ Estrutura do primeiro grupo:`, {
        baseModel: grouped[0].baseModel,
        productsCount: grouped[0].products?.length || 0,
        hasProductsArray: Array.isArray(grouped[0].products),
        bestPrice: grouped[0].bestPrice
      });
    }
    
    // Ordena grupos pelo melhor preço
    grouped.sort((a, b) => a.bestPrice - b.bestPrice);
    
    return grouped;
  } catch (err) {
    console.error("❌ Erro no runScrape:", err.message);
    console.error("❌ Stack:", err.stack);
    throw err;
  } finally {
    if (browser) {
      console.log('🔄 Fechando browser...');
      await browser.close().catch(err => {
        console.warn('⚠️ Erro ao fechar browser:', err.message);
      });
    }
  }
}

app.get("/compare", async (req, res) => {
  const q = (req.query.q || "").toString().trim().toLowerCase();

  if (!q) return res.status(400).json({ error: "Missing query" });

  console.log(`📥 Requisição recebida para: "${q}"`);

  // Verifica cache (válido por 15 minutos)
  if (cache.has(q) && Date.now() - cache.get(q).time < 15 * 60 * 1000) {
    console.log(`✅ Cache hit para: ${q}`);
    const cachedData = cache.get(q).data;
    // Garante que dados do cache estão no formato de grupos
    if (cachedData && cachedData.length > 0 && cachedData[0].products && Array.isArray(cachedData[0].products)) {
      return res.json(cachedData);
    } else {
      // Se cache tem formato antigo, limpa e faz nova busca
      console.log(`⚠️ Cache com formato antigo, limpando...`);
      cache.delete(q);
    }
  }

  console.log(`🔍 Scraping novo para: ${q}`);
  
  // Timeout de 2 minutos para a requisição completa
  const timeout = setTimeout(() => {
    console.error(`⏱️ Timeout de 2 minutos atingido para: ${q}`);
    if (!res.headersSent) {
      res.status(504).json({ error: "timeout", message: "Scraping demorou mais que 2 minutos" });
    }
  }, 120000); // 2 minutos
  
  try {
    const results = await runScrape(q);
    
    clearTimeout(timeout);
    
    console.log(`📊 Resultados recebidos:`, results ? `${results.length} itens` : 'null');
    
    if (!results || results.length === 0) {
      console.warn(`⚠️ Nenhum resultado encontrado para: ${q}`);
      return res.json([]);
    }
    
    console.log(`✅ ${results.length} grupos encontrados para: ${q}`);
    if (results[0]) {
      console.log(`📦 Primeiro grupo:`, {
        baseModel: results[0].baseModel,
        productsCount: results[0].products?.length || 0,
        bestPrice: results[0].bestPrice
      });
    }
    
    // Garante que está retornando grupos
    if (!results[0]?.products || !Array.isArray(results[0].products)) {
      console.error(`❌ ERRO: Resultados não estão no formato de grupos!`);
      console.error(`❌ Estrutura recebida:`, results[0]);
    }
    
    cache.set(q, { data: results, time: Date.now() });
    res.json(results);
  } catch (err) {
    clearTimeout(timeout);
    console.error(`❌ Erro no scraping para "${q}":`, err.message);
    console.error(`❌ Erro name:`, err.name);
    console.error(`❌ Stack:`, err.stack);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "scrape_failed", 
        message: err.message || "Erro desconhecido no scraping"
      });
    }
  }
});



app.get("/", (_,res)=>{

  res.sendFile(path.join(__dirname, "..", "public", "index.html"));

});



// Health check endpoint para verificar se o servidor está rodando (ANTES do listen)
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Endpoint de teste simples
app.get("/api/test", (req, res) => {
  console.log("✅ Test endpoint called");
  res.json({ 
    status: "ok", 
    message: "Server is working",
    timestamp: new Date().toISOString()
  });
});

// Error handler global
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log('📦 Preparando para iniciar servidor na porta', PORT);

try {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📍 Health check: http://0.0.0.0:${PORT}/api/health`);
  });
} catch (error) {
  console.error('❌ Erro ao iniciar servidor:', error);
  console.error('❌ Stack:', error.stack);
  process.exit(1);
}