import "dotenv/config";

import express from "express";

import cors from "cors";

import path from "path";

import axios from "axios";

import { fileURLToPath } from "url";

import pLimit from "p-limit";

import { launchBrowser, scrapeAmazonSite } from "./scrapers/amazonPuppeteer.js";



const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);



const app = express();

app.use(cors());

app.use(express.static(path.join(__dirname, "..", "public")));



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
  const browser = await launchBrowser();
  const limit = pLimit(2); // limitar concorrência para evitar bloqueios

  try {
    const tasks = SITES.map(site => limit(() => scrapeAmazonSite(site, q, browser)
      .catch(err => {
        console.warn(`⚠️ ${site.country} falhou: ${err.message}`);
        return null;
      })
    ));

    const raw = (await Promise.all(tasks)).filter(Boolean);

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
    console.error("compare error:", err.message);
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

app.get("/compare", async (req, res) => {
  const q = (req.query.q || "").toString().trim().toLowerCase();

  if (!q) return res.status(400).json({ error: "Missing query" });

  // Verifica cache (válido por 15 minutos)
  if (cache.has(q) && Date.now() - cache.get(q).time < 15 * 60 * 1000) {
    console.log(`✅ Cache hit para: ${q}`);
    return res.json(cache.get(q).data);
  }

  console.log(`🔍 Scraping novo para: ${q}`);
  
  try {
    const results = await runScrape(q);
    cache.set(q, { data: results, time: Date.now() });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "scrape_failed" });
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

// Error handler global
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

try {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
} catch (error) {
  console.error('❌ Erro ao iniciar servidor:', error);
  process.exit(1);
}