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

const SITES = [

  { country:"🇪🇸 Spain",   domain:"amazon.es",   currency:"EUR" },

  { country:"🇫🇷 France",  domain:"amazon.fr",   currency:"EUR" },

  { country:"🇩🇪 Germany", domain:"amazon.de",   currency:"EUR" },

  { country:"🇮🇹 Italy",   domain:"amazon.it",   currency:"EUR" },

  { country:"🇬🇧 UK",      domain:"amazon.co.uk",currency:"GBP" }

];



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



app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});