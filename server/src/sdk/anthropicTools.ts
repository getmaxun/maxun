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
