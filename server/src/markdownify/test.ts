import { urlToLlmText } from './get_llm_ready_text';

async function demoDualOutput() {
    const testUrls = [
        "https://quotes.toscrape.com/",
        "https://httpbin.org/html",
        "https://example.com",
        "https://amazon.com"
    ];

    for (const url of testUrls) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`Processing: ${url}`);
        console.log(`${'='.repeat(70)}`);

        try {
            const result = await urlToLlmText(url, {
                keepImages: true,
                keepWebpageLinks: true,
                removeScriptTag: true,
                removeStyleTag: true,
                formatAsMarkdown: true
            });

            console.log(`\n METADATA:`);
            console.log(`Title: ${result.metadata.title}`);
            console.log(`URL: ${result.metadata.url}`);
            console.log(`Processed: ${result.metadata.processedAt}`);
            console.log(`Plain text length: ${result.metadata.textLength} chars`);
            console.log(`Markdown length: ${result.metadata.markdownLength} chars`);
            console.log(`Content Score: ${result.metadata.contentScore}/10`);

            console.log(`\nPLAIN TEXT (first 600 chars):`);
            console.log(`${result.plainText.substring(0, 600)}${result.plainText.length > 600 ? '...' : ''}`);

            console.log(`\nMARKDOWN (first 600 chars):`);
            console.log(`${result.markdown.substring(0, 600)}${result.markdown.length > 600 ? '...' : ''}`);

            // Save both formats
            const domain = new URL(url).hostname;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            
            await saveToFile(result.plainText, `output/${domain}_${timestamp}_plain.txt`);
            await saveToFile(result.markdown, `output/${domain}_${timestamp}_markdown.md`);
            
            // Save metadata as JSON
            await saveToFile(JSON.stringify(result.metadata, null, 2), `output/${domain}_${timestamp}_metadata.json`);

            console.log(`\nSaved to output/ directory`);

        } catch (error) {
            console.error(`Error processing ${url}:`, error);
        }
    }
}

async function saveToFile(content: string, filename: string) {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
        // Create directory if it doesn't exist
        const dir = path.dirname(filename);
        await fs.mkdir(dir, { recursive: true });
        
        await fs.writeFile(filename, content, 'utf-8');
    } catch (error) {
        console.error(`Error saving to ${filename}:`, error);
    }
}

// Run the demo
demoDualOutput().catch(console.error);