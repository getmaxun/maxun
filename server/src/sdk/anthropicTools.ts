/**
 * Anthropic Tool Definitions
 * Tool schemas used with callAnthropicWithTool() across workflowEnricher.ts.
 * Each tool forces a single structured decision via tool_choice, replacing
 * regex/JSON.parse extraction from a free-form text completion.
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';

/**
 * Used by getLLMDecisionWithVision to select the best-matching element
 * group (and a runner-up) from a webpage for the data the user wants to
 * scrape.
 */
export const selectGroupCandidatesTool: Tool = {
  name: 'select_group_candidates',
  description:
    'Select the best-matching element group (and a runner-up) for the data the user wants to scrape from a webpage, based on structural signals and sample content shown for each group.',
  input_schema: {
    type: 'object',
    properties: {
      first: {
        type: 'integer',
        description: 'Index of the best-matching group, or -1 if no group matches at all.',
      },
      second: {
        type: 'integer',
        description: 'Index of the runner-up group, or -1. Set equal to "first" if only one group is viable.',
      },
      reason: {
        type: 'string',
        description: 'Brief explanation for the selection.',
      },
      limit: {
        type: ['integer', 'null'],
        description: 'Item-count limit if the user specified a quantity (e.g. "top 50 products"), otherwise null.',
      },
    },
    required: ['first', 'second', 'reason', 'limit'],
  },
};

/**
 * Used by generateFieldLabelsBatch to assign a semantic field name to each
 * generically-labeled detected field, based on its HTML tag/attribute and
 * sample values.
 */
export const assignFieldLabelsTool: Tool = {
  name: 'assign_field_labels',
  description:
    'Assign a clear, semantic, Title Case field name (2-4 words) to each generic detected field, based on its HTML tag/attribute type and sample values.',
  input_schema: {
    type: 'object',
    properties: {
      fieldLabels: {
        type: 'object',
        description: 'Mapping of each generic label (e.g. "Label 1") to its semantic field name.',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['fieldLabels'],
  },
};

/**
 * Used by filterFieldsByIntent to select only the labeled fields that match
 * the user's data-extraction intent, with a confidence score.
 */
export const filterFieldsByIntentTool: Tool = {
  name: 'filter_fields_by_intent',
  description:
    'Select only the labeled fields that match the user\'s data-extraction intent, with a confidence score for the match.',
  input_schema: {
    type: 'object',
    properties: {
      selectedFields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Field names that match the user\'s intent.',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: '1.0 = exact match, 0.8+ = semantic match, <0.7 = uncertain.',
      },
      reasoning: {
        type: 'string',
        description: 'Which keywords from the request matched which fields.',
      },
    },
    required: ['selectedFields', 'confidence', 'reasoning'],
  },
};

/**
 * Used by generateListName to produce a concise, Title Case name for a
 * scraped data list. This is the only one of the tool-migrated call sites
 * that replaces a free-text completion (not a JSON-shaped one) - the model
 * previously replied with bare text like "Product Listings", not JSON.
 */
export const setListNameTool: Tool = {
  name: 'set_list_name',
  description:
    'Provide a concise, descriptive, Title Case name (1-3 words) for a scraped data list, based on the user\'s request and the detected fields.',
  input_schema: {
    type: 'object',
    properties: {
      listName: {
        type: 'string',
        description: 'The list name in Title Case, 1-3 words, no quotes or punctuation.',
      },
    },
    required: ['listName'],
  },
};

/**
 * Used by verifyWorkflowOutput to judge whether sample extracted rows
 * actually match the user's request, versus being navigation/footer/ad/UI
 * noise. required intentionally lists only 'matches' - matching the sibling
 * Ollama jsonSchema exactly - because the call site treats confidence and
 * reasoning as optional-with-defaults (typeof-guarded), not hard
 * requirements.
 */
export const verifyExtractionMatchTool: Tool = {
  name: 'verify_extraction_match',
  description:
    'Judge whether sample rows of extracted webpage data actually match what the user asked to scrape, versus being navigation/footer/ad/UI noise.',
  input_schema: {
    type: 'object',
    properties: {
      matches: {
        type: 'boolean',
        description: 'True if the extracted samples match the user\'s request.',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
      reasoning: {
        type: 'string',
        description: 'One sentence explaining the judgment.',
      },
    },
    required: ['matches'],
  },
};

/**
 * Used by parseSearchIntent to extract a web search query, the extraction
 * goal, and an optional item-count limit from a natural-language request.
 * required intentionally lists only searchQuery/extractionGoal - matching
 * the sibling Ollama jsonSchema exactly - limit stays optional since the
 * call site treats an absent key and an explicit null identically.
 */
export const parseSearchIntentTool: Tool = {
  name: 'parse_search_intent',
  description:
    'Extract a web search query, the extraction goal, and an optional item-count limit from a natural-language data extraction request.',
  input_schema: {
    type: 'object',
    properties: {
      searchQuery: {
        type: 'string',
        description: 'The website/page to search for, suitable as a web search query.',
      },
      extractionGoal: {
        type: 'string',
        description: 'What data the user wants to extract.',
      },
      limit: {
        type: ['integer', 'null'],
        description: 'Item-count limit if specified, otherwise null.',
      },
    },
    required: ['searchQuery', 'extractionGoal'],
  },
};

/**
 * Used by selectBestUrlFromResults to pick the single best search result
 * index most likely to contain the data the user wants.
 */
export const selectBestUrlTool: Tool = {
  name: 'select_best_url',
  description:
    'Select the single best search result index that is most likely to contain the data the user wants to extract.',
  input_schema: {
    type: 'object',
    properties: {
      selectedIndex: {
        type: 'integer',
        description: 'Index of the best search result (0-based).',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
      reasoning: {
        type: 'string',
        description: 'Brief explanation for the choice.',
      },
    },
    required: ['selectedIndex', 'confidence', 'reasoning'],
  },
};

/**
 * Used by isMultiSitePrompt to classify whether a scraping request needs
 * data from multiple different websites/domains, versus a single site.
 */
export const classifyMultiSitePromptTool: Tool = {
  name: 'classify_multi_site_prompt',
  description:
    'Classify whether a web scraping request needs data gathered from multiple different websites/domains, versus a single specific website.',
  input_schema: {
    type: 'object',
    properties: {
      multiSite: {
        type: 'boolean',
        description: 'True if the request implies multiple websites/domains; false for a single site.',
      },
    },
    required: ['multiSite'],
  },
};
