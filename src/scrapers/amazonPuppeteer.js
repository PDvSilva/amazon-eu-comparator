import puppeteer from "puppeteer";

// Amazon domain mappings for EU countries
export const AMAZON_DOMAINS = {
  'uk': 'amazon.co.uk',
  'de': 'amazon.de',
  'fr': 'amazon.fr',
  'it': 'amazon.it',
  'es': 'amazon.es',
  'nl': 'amazon.nl',
  'pl': 'amazon.pl',
  'se': 'amazon.se'
};

// Currency mappings
export const AMAZON_CURRENCIES = {
  'uk': 'GBP',
  'de': 'EUR',
  'fr': 'EUR',
  'it': 'EUR',
  'es': 'EUR',
  'nl': 'EUR',
  'pl': 'EUR',
  'se': 'SEK'
};

/** Parse de preços tipo "1.234,56 €" ou "£329.99" */
export function parsePrice(text) {
  if (!text) return NaN;

  const cleaned = text.replace(/\s/g, '').replace(/[^\d,.\-]/g, '');

  // heurística EUR vs GBP/US
  if (cleaned.includes(',') && cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
    // formatação EU "1.234,56"
    const t = cleaned.replace(/\./g, '').replace(',', '.');
    return parseFloat(t);
  }

  return parseFloat(cleaned.replace(/,/g, ''));
}

/** Scrape do primeiro resultado com preço para um domínio Amazon */
export async function scrapeAmazonSite({ domain, country, currency }, query, browser) {
  const url = `https://${domain}/s?k=${encodeURIComponent(query)}`;

  const page = await browser.newPage();

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    await page.setExtraHTTPHeaders({ "accept-language": "en-GB,en;q=0.9" });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Se cair em CAPTCHA, sai
    const body = await page.content();
    if (/captcha/i.test(body)) throw new Error("CAPTCHA page");

    // Espera pela slot principal
    await page.waitForSelector("div.s-main-slot", { timeout: 15000 });
    
    // Aguarda um pouco mais para os preços carregarem
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extrai o primeiro item com preço visível
    const item = await page.evaluate(() => {
      const slot = document.querySelector("div.s-main-slot");
      if (!slot) return null;

      const cards = Array.from(slot.querySelectorAll("div[data-asin][data-index]"));

      for (const el of cards) {
        // Pega o ASIN diretamente do elemento
        const asin = el.getAttribute("data-asin");
        if (!asin || asin === "") continue; // Pula se não tiver ASIN válido
        
        // Tenta múltiplos seletores de título
        const titleSelectors = [
          "h2 a span",
          "h2 a",
          "h2 span",
          "[data-cy='title-recipe'] a",
          ".s-title-instructions-style a"
        ];
        
        let titleEl = null;
        let hrefEl = null;
        for (const selector of titleSelectors) {
          titleEl = el.querySelector(selector);
          if (titleEl) {
            hrefEl = titleEl.closest('a') || titleEl.querySelector('a') || el.querySelector('h2 a');
            if (hrefEl) break;
          }
        }
        
        // Se não encontrou href, constrói usando o ASIN
        if (!hrefEl && asin) {
          hrefEl = { getAttribute: () => `/dp/${asin}` };
        }
        
        // Tenta múltiplos seletores de preço
        const priceSelectors = [
          ".a-price .a-offscreen",
          ".a-price-whole",
          ".a-price .a-price-whole",
          "span.a-price",
          ".a-price span",
          "[data-a-color='price'] span",
          ".a-price[data-a-color='price']"
        ];
        
        let priceEl = null;
        for (const selector of priceSelectors) {
          priceEl = el.querySelector(selector);
          if (priceEl && priceEl.textContent.trim()) break;
        }
        
        // Se não encontrou, procura qualquer elemento com símbolos de moeda
        if (!priceEl) {
          const allSpans = el.querySelectorAll('span');
          for (const span of allSpans) {
            const text = span.textContent || '';
            if (/[\d,.]+\s*[€£$]|[\d,.]+\s*EUR|[\d,.]+\s*GBP/.test(text)) {
              priceEl = span;
              break;
            }
          }
        }

        if (titleEl && hrefEl && priceEl) {
          const priceText = priceEl.textContent?.trim() || priceEl.getAttribute("aria-label") || priceEl.innerText || "";
          let href = hrefEl.getAttribute("href") || "";
          
          // Filtra links inválidos
          if (href.includes("javascript:") || href.includes("sspa/click") || !href || href === "#") {
            continue; // Pula este item e tenta o próximo
          }
          
          return {
            title: titleEl.textContent?.trim() || titleEl.innerText?.trim() || "",
            href: href,
            priceText: priceText
          };
        }
      }

      return null;
    });

    if (!item) throw new Error("no priced item");

    // Constrói o link corretamente
    let link = null;
    let href = item.href.split("?")[0].split("#")[0]; // Remove query params e hash
    
    // Tenta extrair ASIN do href se não estiver em formato /dp/
    let asin = null;
    const asinMatch = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    if (asinMatch) {
      asin = asinMatch[1];
      href = `/dp/${asin}`;
    }
    
    // Filtra e constrói o link
    if (href.includes("javascript:") || href.includes("sspa/click") || !href || href === "#") {
      throw new Error("invalid link format");
    }
    
    if (href.startsWith("http://") || href.startsWith("https://")) {
      // Link já é absoluto - valida se é da Amazon correta
      if (!href.includes(domain.replace("www.", ""))) {
        // Se for de outro domínio Amazon, extrai o path
        const url = new URL(href);
        href = url.pathname;
        link = `https://${domain}${href}`;
      } else {
        link = href;
      }
    } else if (href.startsWith("/")) {
      // Link relativo que começa com /
      link = `https://${domain}${href}`;
    } else if (href) {
      // Link relativo sem / inicial
      link = `https://${domain}/${href}`;
    }
    
    const price = parsePrice(item.priceText);
    
    // Valida link e preço
    if (!link || !link.includes(domain.replace("www.", "")) || isNaN(price) || price <= 0) {
      throw new Error("bad parse - invalid link or price");
    }

    return { country, domain, currency, title: item.title, link, price };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Arranca um browser único e devolve função de fecho */
export async function launchBrowser() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
    ],
  });
  return browser;
}

/** Wrapper para busca por query usando o novo sistema */
export async function scrapeAmazonByQuery(query, country = 'uk') {
  const domain = AMAZON_DOMAINS[country.toLowerCase()];
  const currency = AMAZON_CURRENCIES[country.toLowerCase()];

  if (!domain) {
    throw new Error(`Unsupported country: ${country}`);
  }

  const browser = await launchBrowser();
  try {
    const result = await scrapeAmazonSite({ domain, country, currency }, query, browser);
    return {
      ...result,
      asin: extractASINFromLink(result.link),
      url: result.link
    };
  } finally {
    await browser.close();
  }
}

/** Helper para extrair ASIN de um link Amazon */
function extractASINFromLink(link) {
  if (!link) return null;
  const match = link.match(/\/dp\/([A-Z0-9]{10})/);
  return match ? match[1] : null;
}

/** Função legada para compatibilidade - busca por ASIN usando query */
export async function scrapeAmazon(asin, country = 'uk') {
  // Tenta buscar diretamente pelo ASIN como query
  return await scrapeAmazonByQuery(asin, country);
}