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
  console.log(`📄 scrapeAmazonSite chamado para ${country} (${domain}) - "${query}"`);
  const url = `https://${domain}/s?k=${encodeURIComponent(query)}`;
  console.log(`🔗 URL: ${url}`);

  console.log(`📄 Criando nova página...`);
  const page = await browser.newPage();
  console.log(`✅ Página criada`);

  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    await page.setExtraHTTPHeaders({ "accept-language": "en-GB,en;q=0.9" });

    console.log(`🌐 Navegando para ${url}...`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    console.log(`✅ Página carregada`);

    // Se cair em CAPTCHA, sai
    const body = await page.content();
    if (/captcha/i.test(body)) {
      console.error(`🚫 CAPTCHA detectado em ${domain}`);
      throw new Error("CAPTCHA page");
    }

    // Verifica se a página carregou corretamente
    const pageTitle = await page.title();
    console.log(`📄 Título da página: ${pageTitle.substring(0, 50)}...`);

    // Espera pela slot principal com retry
    console.log(`⏳ Esperando pelo s-main-slot...`);
    try {
      await page.waitForSelector("div.s-main-slot", { timeout: 20000 });
      console.log(`✅ s-main-slot encontrado`);
    } catch (err) {
      console.warn(`⚠️ s-main-slot não encontrado, tentando continuar...`);
      // Continua mesmo sem encontrar o seletor
    }
    
    // Aguarda um pouco mais para os preços carregarem
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extrai o primeiro item com preço visível
    console.log(`🔍 Extraindo dados da página...`);
    const item = await page.evaluate((domainName) => {
      const slot = document.querySelector("div.s-main-slot");
      if (!slot) {
        console.warn('s-main-slot não encontrado');
        // Tenta encontrar cards em outros lugares
        const altSlot = document.querySelector('[data-component-type="s-search-result"]') || 
                       document.querySelector('.s-result-list') ||
                       document.body;
        if (!altSlot) return null;
        
        // Tenta encontrar cards alternativos
        const altCards = Array.from(altSlot.querySelectorAll('[data-asin]')).filter(el => {
          const asin = el.getAttribute("data-asin");
          return asin && asin !== "";
        });
        
        if (altCards.length === 0) return null;
        
        // Usa o primeiro card alternativo
        const el = altCards[0];
        const asin = el.getAttribute("data-asin");
        
        // Tenta encontrar título e preço
        const titleEl = el.querySelector("h2 a span, h2 a, h2 span") || 
                       el.querySelector('[data-cy="title-recipe"] a');
        const priceEl = el.querySelector(".a-price .a-offscreen, .a-price-whole, .a-price span");
        
        if (titleEl && priceEl && asin) {
          return {
            title: titleEl.textContent.trim(),
            href: `/dp/${asin}`,
            priceText: priceEl.textContent.trim(),
            imageUrl: null
          };
        }
        
        return null;
      }

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
          
          // Extrai imagem do produto - melhorado para pegar imagens reais
          const imageSelectors = [
            '.s-image img',
            'img[data-image-latency]',
            'img[data-a-dynamic-image]',
            '.s-product-image img',
            'img.s-image',
            'img.a-dynamic-image',
            'img[src*="images-na"]',
            'img[src*="images-amazon"]',
            '[data-component-type="s-product-image"] img',
            '.s-result-item img[src*=".jpg"]',
            '.s-result-item img[src*=".png"]'
          ];
          
          let imageUrl = null;
          for (const selector of imageSelectors) {
            const imgEl = el.querySelector(selector);
            if (imgEl) {
              // Tenta múltiplos atributos em ordem de prioridade
              imageUrl = imgEl.getAttribute('data-src') || 
                        imgEl.getAttribute('data-lazy-src') ||
                        imgEl.getAttribute('data-a-dynamic-image') ||
                        imgEl.getAttribute('src') || 
                        imgEl.getAttribute('data-old-src') ||
                        imgEl.getAttribute('data-srcset');
              
              if (imageUrl) {
                // Se for JSON string com múltiplas imagens, pega a maior
                if (imageUrl.startsWith('{')) {
                  try {
                    const imgData = JSON.parse(imageUrl);
                    const urls = Object.keys(imgData);
                    if (urls.length > 0) {
                      // Pega a URL com maior resolução (procura por _AC_SL1500_ ou similar)
                      const highResUrls = urls.filter(url => url.includes('_AC_SL') || url.includes('_AC_'));
                      if (highResUrls.length > 0) {
                        // Ordena por resolução (maior número = maior resolução)
                        imageUrl = highResUrls.sort((a, b) => {
                          const aMatch = a.match(/_AC_SL(\d+)_/);
                          const bMatch = b.match(/_AC_SL(\d+)_/);
                          if (aMatch && bMatch) {
                            return parseInt(bMatch[1]) - parseInt(aMatch[1]);
                          }
                          return b.length - a.length;
                        })[0];
                      } else {
                        imageUrl = urls.sort((a, b) => b.length - a.length)[0];
                      }
                    }
                  } catch {}
                }
                
                // Remove parâmetros de redimensionamento e adiciona parâmetro para imagem maior
                if (imageUrl && imageUrl.includes('_AC_')) {
                  // Substitui por uma resolução maior (SL1500 = 1500px)
                  imageUrl = imageUrl.replace(/_AC_SL\d+_/g, '_AC_SL1500_');
                  imageUrl = imageUrl.replace(/_AC_[^_]+_/g, '_AC_SL1500_');
                }
                
                // Limpa a URL (remove parâmetros de redimensionamento se necessário)
                if (imageUrl && !imageUrl.startsWith('http')) {
                  // Se for relativa, tenta construir URL completa
                  if (imageUrl.startsWith('//')) {
                    imageUrl = 'https:' + imageUrl;
                  } else if (imageUrl.startsWith('/')) {
                    imageUrl = 'https://' + domainName + imageUrl;
                  }
                }
                
                // Remove query parameters que podem causar problemas
                if (imageUrl && imageUrl.includes('?')) {
                  imageUrl = imageUrl.split('?')[0];
                }
                
                if (imageUrl && imageUrl.startsWith('http') && (imageUrl.includes('.jpg') || imageUrl.includes('.png') || imageUrl.includes('images-amazon') || imageUrl.includes('images-na'))) {
                  break;
                }
              }
            }
          }
          
          // Se não encontrou imagem, tenta pegar do ASIN
          if (!imageUrl && asin) {
            imageUrl = `https://images-na.ssl-images-amazon.com/images/I/${asin}.01._AC_SL1500_.jpg`;
            console.log(`📦 Gerando URL de imagem baseada no ASIN: ${asin}`);
          }
          
          // Se ainda não tem imagem, tenta construir URL genérica baseada no domínio
          if (!imageUrl) {
            // Tenta extrair ASIN do href se ainda não tiver
            const asinFromHref = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
            if (asinFromHref && asinFromHref[1]) {
              const extractedAsin = asinFromHref[1];
              imageUrl = `https://images-na.ssl-images-amazon.com/images/I/${extractedAsin}.01._AC_SL1500_.jpg`;
              console.log(`📦 Gerando URL de imagem baseada no ASIN extraído do href: ${extractedAsin}`);
            }
          }
          
          return {
            title: titleEl.textContent?.trim() || titleEl.innerText?.trim() || "",
            href: href,
            priceText: priceText,
            imageUrl: imageUrl
          };
        }
      }

      return null;
    }, domain);

    if (!item) {
      console.warn(`⚠️ Nenhum item com preço encontrado em ${domain} para "${query}"`);
      console.warn(`⚠️ Título da página: ${pageTitle}`);
      console.warn(`⚠️ URL: ${url}`);
      throw new Error("no priced item");
    }
    
    console.log(`✅ Item encontrado em ${domain}:`, {
      title: item.title?.substring(0, 50) + '...',
      price: item.priceText,
      hasImage: !!item.imageUrl,
      href: item.href?.substring(0, 50)
    });
    
    if (!item.title || !item.priceText || !item.href) {
      console.error(`❌ Item incompleto:`, {
        hasTitle: !!item.title,
        hasPrice: !!item.priceText,
        hasHref: !!item.href
      });
      throw new Error("incomplete item data");
    }

    // Constrói o link corretamente
    let link = null;
    let href = item.href.split("?")[0].split("#")[0]; // Remove query params e hash
    
    // Tenta extrair ASIN do href se não estiver em formato /dp/
    let asin = null;
    const asinMatch = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    if (asinMatch) {
      asin = asinMatch[1];
      href = `/dp/${asin}`;
    } else {
      // Tenta extrair ASIN de outros formatos de URL
      const asinMatch2 = href.match(/\/gp\/product\/([A-Z0-9]{10})/);
      if (asinMatch2) {
        asin = asinMatch2[1];
      }
      // Tenta extrair do próprio item se disponível (do data-asin)
      // Isso será feito mais abaixo se necessário
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

    // Busca imagem melhor apenas se não tiver uma boa da busca (para otimizar velocidade)
    let finalImageUrl = item.imageUrl;
    
    // Só busca na página do produto se não tiver imagem ou se for de baixa qualidade
    const needsBetterImage = !finalImageUrl || 
                             !finalImageUrl.includes('_AC_SL') || 
                             finalImageUrl.includes('_AC_SL75_') || 
                             finalImageUrl.includes('_AC_SL150_') ||
                             finalImageUrl.includes('_AC_SL300_');
    
    if (needsBetterImage) {
      try {
        console.log(`🖼️ Buscando imagem melhor (timeout 5s): ${link.substring(0, 60)}...`);
        const productPage = await browser.newPage();
        await productPage.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        );
        await productPage.setExtraHTTPHeaders({ "accept-language": "en-GB,en;q=0.9" });
        
        // Timeout reduzido para 5s e wait mínimo
        await Promise.race([
          productPage.goto(link, { waitUntil: "domcontentloaded", timeout: 5000 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]).catch(() => {});
        
        await productPage.waitForTimeout(500); // Aguarda mínimo necessário
        
        // Busca a imagem principal do produto com múltiplas estratégias
        const productImage = await productPage.evaluate(() => {
        // Função auxiliar para processar URL de imagem
        const processImageUrl = (imgUrl) => {
          if (!imgUrl) return null;
          
          // Se for JSON, pega a maior resolução
          if (imgUrl.startsWith('{')) {
            try {
              const imgData = JSON.parse(imgUrl);
              const urls = Object.keys(imgData);
              if (urls.length > 0) {
                // Prioriza SL1500, SL2000 ou maior
                const highRes = urls.filter(u => 
                  u.includes('_AC_SL1500_') || 
                  u.includes('_AC_SL2000_') || 
                  u.includes('_AC_SL2500_')
                );
                if (highRes.length > 0) {
                  // Ordena por resolução (maior primeiro)
                  return highRes.sort((a, b) => {
                    const aMatch = a.match(/_AC_SL(\d+)_/);
                    const bMatch = b.match(/_AC_SL(\d+)_/);
                    if (aMatch && bMatch) {
                      return parseInt(bMatch[1]) - parseInt(aMatch[1]);
                    }
                    return b.length - a.length;
                  })[0];
                } else {
                  // Ordena por resolução
                  return urls.sort((a, b) => {
                    const aMatch = a.match(/_AC_SL(\d+)_/);
                    const bMatch = b.match(/_AC_SL(\d+)_/);
                    if (aMatch && bMatch) {
                      return parseInt(bMatch[1]) - parseInt(aMatch[1]);
                    }
                    return b.length - a.length;
                  })[0];
                }
              }
            } catch {}
          }
          
          return imgUrl;
        };
        
        // Estratégia 1: Seletores principais da página do produto
        const mainSelectors = [
          '#landingImage',
          '#imgBlkFront',
          '#main-image',
          '#imageBlock_feature_div img',
          '#leftCol img[data-a-dynamic-image]',
          '#main-image-container img',
          '.a-dynamic-image[data-a-dynamic-image]',
          '[data-a-image-name="landingImage"]',
          '#productImage',
          '.a-button-selected img',
          '#imageBlock_feature_div .a-dynamic-image',
          '#imageBlock img',
          '#main-image-container .a-dynamic-image',
          '.a-button-thumbnail img[data-a-dynamic-image]',
          '#altImages img[data-a-dynamic-image]'
        ];
        
        for (const selector of mainSelectors) {
          const img = document.querySelector(selector);
          if (img) {
            let imgUrl = img.getAttribute('data-a-dynamic-image') || 
                        img.getAttribute('data-src') ||
                        img.getAttribute('src') ||
                        img.getAttribute('data-old-src') ||
                        img.getAttribute('data-lazy-src');
            
            imgUrl = processImageUrl(imgUrl);
            
            if (imgUrl) {
              // Garante alta resolução
              if (imgUrl.includes('_AC_')) {
                imgUrl = imgUrl.replace(/_AC_SL\d+_/g, '_AC_SL1500_');
                imgUrl = imgUrl.replace(/_AC_[^_]+_/g, '_AC_SL1500_');
              }
              
              // Remove query params
              if (imgUrl.includes('?')) {
                imgUrl = imgUrl.split('?')[0];
              }
              
              // Valida URL
              if (imgUrl && imgUrl.startsWith('http') && 
                  (imgUrl.includes('.jpg') || imgUrl.includes('.png') || 
                   imgUrl.includes('images-amazon') || imgUrl.includes('images-na'))) {
                return imgUrl;
              }
            }
          }
        }
        
        // Estratégia 2: Busca todas as imagens e pega a maior
        const allImages = document.querySelectorAll('img[data-a-dynamic-image], img[src*="images-amazon"], img[src*="images-na"]');
        let bestImage = null;
        let bestSize = 0;
        
        for (const img of allImages) {
          let imgUrl = img.getAttribute('data-a-dynamic-image') || 
                      img.getAttribute('src');
          
          imgUrl = processImageUrl(imgUrl);
          
          if (imgUrl && imgUrl.startsWith('http')) {
            // Tenta extrair tamanho da URL
            const sizeMatch = imgUrl.match(/_AC_SL(\d+)_/);
            const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
            
            if (size > bestSize) {
              bestSize = size;
              bestImage = imgUrl;
            }
          }
        }
        
        if (bestImage) {
          // Garante alta resolução
          if (bestImage.includes('_AC_')) {
            bestImage = bestImage.replace(/_AC_SL\d+_/g, '_AC_SL1500_');
            bestImage = bestImage.replace(/_AC_[^_]+_/g, '_AC_SL1500_');
          }
          
          if (bestImage.includes('?')) {
            bestImage = bestImage.split('?')[0];
          }
          
          return bestImage;
        }
        
        return null;
      });
      
      if (productImage) {
        console.log(`✅ Imagem de alta qualidade encontrada: ${productImage.substring(0, 80)}...`);
        finalImageUrl = productImage;
      } else {
        console.log(`⚠️ Não encontrou imagem na página do produto, usando da busca`);
      }
      
      await productPage.close().catch(() => {});
      } catch (error) {
        console.log(`⚠️ Erro ao buscar imagem (usando da busca): ${error.message}`);
        // Continua com a imagem da busca se houver
      }
    } else {
      console.log(`✅ Usando imagem da busca (já é de boa qualidade)`);
    }
    
    // Se ainda não tem imagem e tem ASIN, usa fallback
    if (!finalImageUrl && asin) {
      finalImageUrl = `https://images-na.ssl-images-amazon.com/images/I/${asin}.01._AC_SL1500_.jpg`;
      console.log(`📦 Usando imagem fallback baseada no ASIN: ${asin}`);
    } else if (!finalImageUrl) {
      // Última tentativa: extrai ASIN do link final
      const finalAsinMatch = link.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
      if (finalAsinMatch && finalAsinMatch[1]) {
        const finalAsin = finalAsinMatch[1];
        finalImageUrl = `https://images-na.ssl-images-amazon.com/images/I/${finalAsin}.01._AC_SL1500_.jpg`;
        console.log(`📦 Usando imagem fallback baseada no ASIN extraído do link final: ${finalAsin}`);
      }
    }

    return { 
      country, 
      domain, 
      currency, 
      title: item.title, 
      link, 
      price,
      imageUrl: finalImageUrl || null
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Arranca um browser único e devolve função de fecho */
export async function launchBrowser() {
  console.log("🚀 Starting Puppeteer...");
  
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
      '--disable-software-rasterizer',
      '--disable-extensions'
    ],
  };
  
  // Tenta usar Chrome do sistema primeiro (Render/Railway já tem instalado)
  // Se não encontrar, Puppeteer usa o Chrome baixado automaticamente
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    console.log(`✅ Usando Chrome do sistema (env): ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
  } else {
    // Tenta encontrar Chrome em locais comuns
    try {
      const fs = await import('fs');
      const possiblePaths = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome'
      ];
      
      for (const path of possiblePaths) {
        if (fs.existsSync(path)) {
          launchOptions.executablePath = path;
          console.log(`✅ Usando Chrome do sistema: ${path}`);
          break;
        }
      }
      
      if (!launchOptions.executablePath) {
        console.log("📦 Usando Chrome do Puppeteer (será baixado automaticamente)");
      }
    } catch (err) {
      console.log("📦 Usando Chrome do Puppeteer (será baixado automaticamente)");
    }
  }
  
  try {
    const browser = await puppeteer.launch(launchOptions);
    console.log("✅ Chrome iniciado com sucesso!");
    return browser;
  } catch (error) {
    console.error("❌ Erro ao iniciar Puppeteer:", error);
    throw error;
  }
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