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

// Lazy import do Puppeteer - só importa quando necessário
let launchBrowser, scrapeAmazonSite;
async function loadScraper() {
  if (!launchBrowser) {
    console.log('📦 Carregando scraper (lazy)...');
    try {
      const scraperModule = await import("./scrapers/amazonPuppeteer.js");
      launchBrowser = scraperModule.launchBrowser;
      scrapeAmazonSite = scraperModule.scrapeAmazonSite;
      console.log('✅ Scraper carregado com sucesso');
      console.log('✅ launchBrowser:', typeof launchBrowser);
      console.log('✅ scrapeAmazonSite:', typeof scrapeAmazonSite);
    } catch (error) {
      console.error('❌ Erro ao carregar scraper:', error);
      throw error;
    }
  }
  return { launchBrowser, scrapeAmazonSite };
}



const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

console.log('✅ Paths configurados');

const app = express();

app.use(cors());

app.use(express.static(path.join(__dirname, "..", "public")));

console.log('✅ Express configurado');



const PORT = process.env.PORT || 10000;

const cache = new Map(); // Cache para armazenar resultados

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
  
  // Carrega o scraper apenas quando necessário
  let browser;
  try {
    console.log('📥 Chamando loadScraper()...');
    const { launchBrowser: lb, scrapeAmazonSite: sas } = await loadScraper();
    console.log('📦 Scraper carregado, iniciando browser...');
    console.log('📦 Tipo de lb:', typeof lb);
    
    if (typeof lb !== 'function') {
      throw new Error('launchBrowser não é uma função');
    }
    
    console.log('🌐 Chamando launchBrowser()...');
    browser = await Promise.race([
      lb(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Puppeteer timeout após 30s')), 30000)
      )
    ]);
    console.log('✅ Browser iniciado');
    
    const limit = pLimit(2); // limitar concorrência para evitar bloqueios

    console.log(`🌍 Iniciando scraping em ${SITES.length} sites...`);
    const tasks = SITES.map(site => limit(() => {
      console.log(`🔍 Scraping ${site.country} (${site.domain})...`);
      return sas(site, q, browser)
        .then(result => {
          console.log(`✅ ${site.country} sucesso`);
          return result;
        })
        .catch(err => {
          console.warn(`⚠️ ${site.country} falhou: ${err.message}`);
          return null;
        });
    }));

    const raw = (await Promise.all(tasks)).filter(Boolean);
    console.log(`📊 ${raw.length} de ${SITES.length} sites retornaram resultados`);

    for (const r of raw) {
      r.priceEUR = await toEUR(r.price, r.currency);
      
      // Adiciona tag de afiliado ao link
      const site = SITES.find(s => s.domain === r.domain);
      if (site && site.tag) {
        r.link = addAffiliateTag(r.link, site.tag);
      }
    }

    raw.sort((a, b) => a.priceEUR - b.priceEUR);
    
    return raw;
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
    return res.json(cache.get(q).data);
  }

  console.log(`🔍 Scraping novo para: ${q}`);
  
  try {
    const results = await runScrape(q);
    
    if (!results || results.length === 0) {
      console.warn(`⚠️ Nenhum resultado encontrado para: ${q}`);
      return res.json([]);
    }
    
    console.log(`✅ ${results.length} resultados encontrados para: ${q}`);
    cache.set(q, { data: results, time: Date.now() });
    res.json(results);
  } catch (err) {
    console.error(`❌ Erro no scraping para "${q}":`, err.message);
    console.error(`❌ Stack:`, err.stack);
    res.status(500).json({ error: "scrape_failed", message: err.message });
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