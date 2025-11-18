import { getPageSource } from './get_html';
import { getProcessedText } from './get_llm_input_text';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

async function debugTurndown() {
    const testUrls = [
        "https://amazon.com/",
    ];

    for (const url of testUrls) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`🔍 Testing URL: ${url}`);
        console.log(`${'='.repeat(70)}`);
        
        try {
            const pageSource = await getPageSource(url, {
                wait: 3.0, // Longer wait time
                timeout: 15000 // 15 second timeout
            });
            
            if (!pageSource || pageSource.length < 100) {
                console.error("❌ No page source received or content too short");
                continue;
            }

            // Save raw HTML for inspection
            const fs = await import('fs/promises');
            const domain = new URL(url).hostname;
            await fs.writeFile(`debug_${domain}_raw.html`, pageSource);
            console.log(`💾 Raw HTML saved to debug_${domain}_raw.html (${pageSource.length} chars)`);

            // Parse with cheerio
            const $ = cheerio.load(pageSource);
            
            // Check what's in the body
            const bodyText = $('body').text();
            console.log(`📄 Body text length: ${bodyText.length} chars`);
            console.log(`📄 Body preview: ${bodyText.substring(0, 200)}...`);

            // Test content extraction
            const contentSelectors = [
                'main', 'article', '[role="main"]', '.content', '.main-content',
                '#content', '#main', '.post', '.article'
            ];

            let mainContent: cheerio.Cheerio<any> = $('body');
            let foundSelector = 'body (fallback)';
            
            for (const selector of contentSelectors) {
                const $content = $(selector).first();
                if ($content.length > 0 && $content.text().trim().length > 10) {
                    console.log(`✅ Found content with selector: ${selector}`);
                    console.log(`📝 Content text length: ${$content.text().length}`);
                    mainContent = $content;
                    foundSelector = selector;
                    break;
                }
            }

            console.log(`🎯 Using content from: ${foundSelector}`);

            // Test Turndown directly
            console.log("\n🧪 Testing Turndown directly...");
            const turndownService = new TurndownService();
            
            if (mainContent.length > 0) {
                const contentHtml = mainContent.html() || '';
                if (contentHtml && contentHtml.length > 10) {
                    console.log(`📦 Content HTML length: ${contentHtml.length} chars`);
                    
                    try {
                        const contentMarkdown = turndownService.turndown(contentHtml);
                        console.log(`📝 Turndown result length: ${contentMarkdown.length} chars`);
                        
                        if (contentMarkdown.length > 0) {
                            console.log(`📝 Markdown preview: ${contentMarkdown.substring(0, 300)}...`);
                            await fs.writeFile(`debug_${domain}_turndown.md`, contentMarkdown);
                            console.log(`💾 Turndown output saved to debug_${domain}_turndown.md`);
                        } else {
                            console.log("❌ Turndown produced empty markdown");
                        }
                    } catch (turndownError) {
                        console.error("❌ Turndown conversion failed:", turndownError);
                    }
                } else {
                    console.log("❌ No HTML content found for Turndown");
                }
            }

            // Test our full function
            console.log("\n🧪 Testing full getProcessedText function...");
            const result = await getProcessedText(pageSource, url, {
                keepImages: true,
                keepWebpageLinks: true,
                removeScriptTag: true,
                removeStyleTag: true,
                formatAsMarkdown: true
            });

            console.log("📊 Result metadata:");
            console.log(`- Markdown length: ${result.metadata.markdownLength} chars`);
            console.log(`- Plain text length: ${result.metadata.textLength} chars`);
            console.log(`- Has content: ${result.metadata.hasContent}`);
            console.log(`- Content score: ${result.metadata.contentScore}/10`);

            if (result.markdown && result.markdown.length > 0) {
                console.log(`📄 Markdown preview (300 chars):`);
                console.log(result.markdown.substring(0, 300) + '...');
                await fs.writeFile(`debug_${domain}_full.md`, result.markdown);
                console.log(`💾 Full output saved to debug_${domain}_full.md`);
            } else {
                console.log("❌ Empty markdown from full function");
                
                // Debug why it's empty
                if (result.plainText && result.plainText.length > 0) {
                    console.log("ℹ️  But plain text has content, so markdown conversion failed");
                    await fs.writeFile(`debug_${domain}_plain.txt`, result.plainText);
                    console.log(`💾 Plain text saved to debug_${domain}_plain.txt`);
                }
            }

        } catch (error) {
            console.error(`💥 Error processing ${url}:`, error);
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

debugTurndown().catch(console.error);