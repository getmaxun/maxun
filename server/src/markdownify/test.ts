import { convertPageToMarkdown } from "./scrape";

(async () => {
  const md = await convertPageToMarkdown("https://quotes.toscrape.com/");
  console.log(md);
})();
