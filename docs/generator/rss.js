const https = require('https');
const http = require('http');
const { URL } = require('url');

async function fetchRSS(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
        try {
            const parsedUrl = new URL(url);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            
            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; Axiologic RSS Reader/2.0)',
                    'Accept': 'application/rss+xml, application/xml, text/xml, */*'
                },
                timeout: timeout
            };

            const req = protocol.get(url, options, (res) => {
                // Handle redirects
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
                    const redirectUrl = res.headers.location;
                    if (redirectUrl) {
                        console.log(`    Following redirect to: ${redirectUrl}`);
                        return fetchRSS(redirectUrl, timeout).then(resolve).catch(reject);
                    }
                }
                
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }
                
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (data.length === 0) {
                        reject(new Error('Empty RSS feed'));
                    } else {
                        resolve(data);
                    }
                });
            });
            
            req.on('timeout', () => {
                req.abort();
                reject(new Error(`RSS fetch timeout after ${timeout}ms`));
            });
            
            req.on('error', (err) => {
                reject(new Error(`Network error: ${err.message}`));
            });
        } catch (err) {
            reject(new Error(`Invalid URL or fetch error: ${err.message}`));
        }
    });
}

function parseRSSItem(item, isRDF = false) {
    const cleanHtmlText = (text) => {
        if (!text) return '';
        
        // Remove CDATA sections
        text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
        
        // Remove CSS class attributes (common in Reddit feeds)
        text = text.replace(/[\[&[^\]]+\]/g, '');
        text = text.replace(/class="[^"]*"/g, '');
        text = text.replace(/style="[^"]*"/g, '');
        
        // Remove script and style tags with their content
        text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        
        // Convert common HTML tags to spaces for readability
        text = text.replace(/<br\s*\/?>/gi, ' ');
        text = text.replace(/<\/p>/gi, ' ');
        text = text.replace(/<\/div>/gi, ' ');
        text = text.replace(/<\/li>/gi, ' ');
        
        // Remove all remaining HTML tags
        text = text.replace(/<[^>]+>/g, ' ');
        
        // Decode HTML entities (comprehensive list)
        text = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&#x27;/g, "'")
            .replace(/&#x2F;/g, '/')
            .replace(/&#([0-9]+);/g, (match, num) => String.fromCharCode(num))
            .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/&mdash;/g, '—')
            .replace(/&ndash;/g, '–')
            .replace(/&hellip;/g, '...')
            .replace(/&bull;/g, '•')
            .replace(/&copy;/g, '©')
            .replace(/&reg;/g, '®')
            .replace(/&trade;/g, '™');
        
        // Clean up whitespace
        text = text
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .trim();
        
        return text;
    };
    
    const getTextContent = (tag) => {
        try {
            // Remove any namespace prefix for matching
            const baseTag = tag.replace(/^[^:]+:/, '');
            
            // Try CDATA pattern first
            const cdataPattern = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${baseTag}>`, 'i');
            const cdataMatch = item.match(cdataPattern);
            if (cdataMatch && cdataMatch[1]) {
                return cleanHtmlText(cdataMatch[1]);
            }

            // Try regular pattern with optional namespace
            const regularPattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${baseTag}>`, 'i');
            const regularMatch = item.match(regularPattern);
            if (regularMatch && regularMatch[1]) {
                return cleanHtmlText(regularMatch[1]);
            }
            
            // For link tags, also check href attribute
            if (baseTag === 'link' || tag === 'link') {
                // First try to get text content
                const linkTextMatch = item.match(/<link[^>]*>([^<]+)<\/link>/i);
                if (linkTextMatch && linkTextMatch[1] && linkTextMatch[1].trim()) {
                    return linkTextMatch[1].trim();
                }
                // Then try href attribute (for Atom feeds)
                const hrefMatch = item.match(/<link[^>]*href="([^"]+)"/i);
                if (hrefMatch && hrefMatch[1]) {
                    return hrefMatch[1].trim();
                }
            }
        } catch (e) {
            // Silently fail
        }
        
        return '';
    };

    // Handle RDF namespaces
    const nsPrefix = isRDF ? '(?:dc:|rdf:|)' : '';
    
    return {
        title: getTextContent(nsPrefix + 'title') || getTextContent('dc:title'),
        description: getTextContent(nsPrefix + 'description') || getTextContent('summary') || getTextContent('content') || getTextContent('dc:description'),
        link: getTextContent(nsPrefix + 'link') || getTextContent('guid') || getTextContent('dc:identifier'),
        pubDate: getTextContent('pubDate') || getTextContent('published') || getTextContent('updated') || getTextContent('dc:date'),
        category: getTextContent('category') || getTextContent('dc:subject'),
        author: getTextContent('author') || getTextContent('dc:creator') || getTextContent('creator')
    };
}

function parseRSS(xml) {
    const items = [];
    
    // Detect feed type
    const isRDF = xml.includes('xmlns:rdf=') || xml.includes('<rdf:RDF');
    const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"');
    
    // Support RSS 2.0, Atom, and RDF/RSS 1.0 feeds
    let itemMatches;
    if (isRDF) {
        // RDF uses <item> tags but with different structure
        itemMatches = xml.matchAll(/<item[^>]*>[\s\S]*?<\/item>/gi);
    } else if (isAtom) {
        itemMatches = xml.matchAll(/<entry[^>]*>[\s\S]*?<\/entry>/gi);
    } else {
        // Standard RSS 2.0
        itemMatches = xml.matchAll(/<item[^>]*>[\s\S]*?<\/item>/gi);
    }

    for (const match of itemMatches) {
        try {
            const item = parseRSSItem(match[0], isRDF);
            if (item.title && (item.link || item.description)) {
                // Parse date more robustly
                if (item.pubDate) {
                    const parsedDate = new Date(item.pubDate);
                    item.pubDate = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
                } else {
                    item.pubDate = new Date();
                }
                items.push(item);
            }
        } catch (err) {
            // Silently skip malformed items
        }
    }

    return items.sort((a, b) => b.pubDate - a.pubDate);
}

module.exports = {
    fetchRSS,
    parseRSS
};
