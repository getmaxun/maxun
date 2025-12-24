/**
 * Workflow Enricher
 * Converts simplified SDK workflow to full format with validation
 */

import { SelectorValidator } from './selectorValidator';
import { createRemoteBrowserForValidation, destroyRemoteBrowser } from '../browser-management/controller';
import logger from '../logger';
import { v4 as uuid } from 'uuid';
import { encrypt } from '../utils/auth';
import Anthropic from '@anthropic-ai/sdk';

interface SimplifiedAction {
  action: string | typeof Symbol.asyncDispose;
  args?: any[];
  name?: string;
  actionId?: string;
}

type RegexableString = string | { $regex: string };

interface SimplifiedWorkflowPair {
  where: {
    url?: RegexableString;
    [key: string]: any;
  };
  what: SimplifiedAction[];
}

export class WorkflowEnricher {
  /**
   * Enrich a simplified workflow with full metadata
   */
  static async enrichWorkflow(
    simplifiedWorkflow: SimplifiedWorkflowPair[],
    userId: string
  ): Promise<{ success: boolean; workflow?: any[]; errors?: string[]; url?: string }> {
    const errors: string[] = [];
    const enrichedWorkflow: any[] = [];

    if (simplifiedWorkflow.length === 0) {
      return { success: false, errors: ['Workflow is empty'] };
    }

    let url: string | undefined;
    for (const step of simplifiedWorkflow) {
      const rawUrl = step.where.url;
      if (rawUrl && rawUrl !== 'about:blank') {
        url = typeof rawUrl === 'string' ? rawUrl : rawUrl.$regex;
        break;
      }
    }

    if (!url) {
      return { success: false, errors: ['No valid URL found in workflow'] };
    }

    let browserId: string | null = null;
    const validator = new SelectorValidator();

    try {
      logger.info('Creating RemoteBrowser for validation');
      const { browserId: id, page } = await createRemoteBrowserForValidation(userId);
      browserId = id;

      await validator.initialize(page, url);

      for (const step of simplifiedWorkflow) {
        const enrichedStep: any = {
          where: { ...step.where },
          what: []
        };

        const selectors: string[] = [];

        for (const action of step.what) {
          if (typeof action.action !== 'string') {
            continue;
          }

          if (action.action === 'type') {
            if (!action.args || action.args.length < 2) {
              errors.push('type action missing selector or value');
              continue;
            }

            const selector = action.args[0];
            const value = action.args[1];
            const providedInputType = action.args[2];

            selectors.push(selector);

            const encryptedValue = encrypt(value);

            if (!providedInputType) {
              try {
                const inputType = await validator.detectInputType(selector);
                enrichedStep.what.push({
                  ...action,
                  args: [selector, encryptedValue, inputType]
                });
              } catch (error: any) {
                errors.push(`type action: ${error.message}`);
                continue;
              }
            } else {
              enrichedStep.what.push({
                ...action,
                args: [selector, encryptedValue, providedInputType]
              });
            }

            enrichedStep.what.push({
              action: 'waitForLoadState',
              args: ['networkidle']
            });

            continue;
          }

          if (action.action !== 'scrapeSchema' && action.action !== 'scrapeList') {
            enrichedStep.what.push(action);
            continue;
          }

          if (action.action === 'scrapeSchema') {
            if (!action.args || !action.args[0]) {
              errors.push('scrapeSchema action missing fields argument');
              continue;
            }
            const fields = action.args[0];
            const result = await validator.validateSchemaFields(fields);

            if (!result.valid) {
              errors.push(...(result.errors || []));
              continue;
            }

            const enrichedFields: Record<string, any> = {};
            for (const [fieldName, enrichedData] of Object.entries(result.enriched!)) {
              enrichedFields[fieldName] = {
                tag: enrichedData.tag,
                isShadow: enrichedData.isShadow,
                selector: enrichedData.selector,
                attribute: enrichedData.attribute
              };

              selectors.push(enrichedData.selector);
            }

            const enrichedAction: any = {
              action: 'scrapeSchema',
              actionId: `text-${uuid()}`,
              args: [enrichedFields]
            };
            if (action.name) {
              enrichedAction.name = action.name;
            }
            enrichedStep.what.push(enrichedAction);

            enrichedStep.what.push({
              action: 'waitForLoadState',
              args: ['networkidle']
            });

          } else if (action.action === 'scrapeList') {
            if (!action.args || !action.args[0]) {
              errors.push('scrapeList action missing config argument');
              continue;
            }
            const config = action.args[0];

            let enrichedFields: Record<string, any> = {};
            let listSelector: string;

            try {
              const autoDetectResult = await validator.autoDetectListFields(config.itemSelector);

              if (!autoDetectResult.success || !autoDetectResult.fields || Object.keys(autoDetectResult.fields).length === 0) {
                errors.push(autoDetectResult.error || 'Failed to auto-detect fields from list selector');
                continue;
              }

              enrichedFields = autoDetectResult.fields;
              listSelector = autoDetectResult.listSelector!;
            } catch (error: any) {
              errors.push(`Field auto-detection failed: ${error.message}`);
              continue;
            }

            let paginationType = 'none';
            let paginationSelector = '';

            if (config.pagination && config.pagination.type) {
              paginationType = config.pagination.type;
              paginationSelector = config.pagination.selector || '';
            } else {
              try {
                const paginationResult = await validator.autoDetectPagination(config.itemSelector);

                if (paginationResult.success && paginationResult.type) {
                  paginationType = paginationResult.type;
                  paginationSelector = paginationResult.selector || '';
                } 
              } catch (error: any) {
                logger.warn('Pagination auto-detection failed, using default (none):', error.message);
              }
            }

            const enrichedListAction: any = {
              action: 'scrapeList',
              actionId: `list-${uuid()}`,
              args: [{
                fields: enrichedFields,
                listSelector: listSelector,
                pagination: {
                  type: paginationType,
                  selector: paginationSelector
                },
                limit: config.maxItems || 100
              }]
            };
            if (action.name) {
              enrichedListAction.name = action.name;
            }
            enrichedStep.what.push(enrichedListAction);

            enrichedStep.what.push({
              action: 'waitForLoadState',
              args: ['networkidle']
            });
          }
        }

        if (selectors.length > 0) {
          enrichedStep.where.selectors = selectors;
        }

        enrichedWorkflow.push(enrichedStep);
      }

      await validator.close();

      if (browserId) {
        await destroyRemoteBrowser(browserId, userId);
        logger.info('RemoteBrowser cleaned up successfully');
      }

      if (errors.length > 0) {
        return { success: false, errors };
      }

      return { success: true, workflow: enrichedWorkflow, url };

    } catch (error: any) {
      await validator.close();

      if (browserId) {
        try {
          await destroyRemoteBrowser(browserId, userId);
          logger.info('RemoteBrowser cleaned up after error');
        } catch (cleanupError) {
          logger.warn('Failed to cleanup RemoteBrowser:', cleanupError);
        }
      }

      logger.error('Error enriching workflow:', error);
      return { success: false, errors: [error.message] };
    }
  }


  /**
   * Generate workflow from natural language prompt using LLM with vision
   */
  static async generateWorkflowFromPrompt(
    url: string,
    prompt: string,
    userId: string,
    llmConfig?: {
      provider?: 'anthropic' | 'openai' | 'ollama';
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    },
  ): Promise<{ success: boolean; workflow?: any[]; url?: string; errors?: string[] }> {
    let browserId: string | null = null;
    const validator = new SelectorValidator();

    try {
      logger.info(`Generating workflow from prompt for URL: ${url}`);
      logger.info(`Prompt: ${prompt}`);

      logger.info('Creating RemoteBrowser for LLM workflow generation');
      const { browserId: id, page } = await createRemoteBrowserForValidation(userId);
      browserId = id;

      await validator.initialize(page as any, url);

      const validatorPage = (validator as any).page;
      // Use JPEG with quality 85 for faster processing and smaller file size
      // Vision models handle this compression well while maintaining accuracy
      const screenshotBuffer = await page.screenshot({ 
        fullPage: true, 
        type: 'jpeg',
        quality: 85
      });
      const screenshotBase64 = screenshotBuffer.toString('base64');

      const elementGroups = await this.analyzePageGroups(validator);
      logger.info(`Found ${elementGroups.length} element groups`);

      const pageHTML = await validatorPage.content();

      const llmDecision = await this.getLLMDecisionWithVision(
        prompt,
        screenshotBase64,
        elementGroups,
        pageHTML,
        llmConfig
      );
      logger.info(`LLM decided action type: ${llmDecision.actionType}`);

      const workflow = await this.buildWorkflowFromLLMDecision(llmDecision, url, validator, prompt, llmConfig);

      await validator.close();

      if (browserId) {
        await destroyRemoteBrowser(browserId, userId);
        logger.info('RemoteBrowser cleaned up after LLM workflow generation');
      }

      return { success: true, workflow, url };
    } catch (error: any) {
      await validator.close();

      if (browserId) {
        try {
          await destroyRemoteBrowser(browserId, userId);
          logger.info('RemoteBrowser cleaned up after LLM generation error');
        } catch (cleanupError) {
          logger.warn('Failed to cleanup RemoteBrowser:', cleanupError);
        }
      }

      logger.error('Error generating workflow from prompt:', error);
      return { success: false, errors: [error.message] };
    }
  }

  /**
   * Analyze page groups using browser-side script
   */
  private static async analyzePageGroups(validator: SelectorValidator): Promise<any[]> {
    try {
      const page = (validator as any).page;
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(__dirname, 'browserSide/pageAnalyzer.js');
      const scriptContent = fs.readFileSync(scriptPath, 'utf8');

      await page.evaluate((script: string) => {
        eval(script);
      }, scriptContent);

      const groups = await page.evaluate(() => {
        const win = window as any;
        if (typeof win.analyzeElementGroups === 'function') {
          return win.analyzeElementGroups();
        }
        return [];
      });

      return groups;
    } catch (error: any) {
      logger.error('Error analyzing page groups:', error);
      return [];
    }
  }

  /**
   * Use LLM (with or without vision) to decide action and select best element/group
   */
  private static async getLLMDecisionWithVision(
    prompt: string,
    screenshotBase64: string,
    elementGroups: any[],
    pageHTML: string,
    llmConfig?: {
      provider?: 'anthropic' | 'openai' | 'ollama';
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    }
  ): Promise<any> {
    try {
      const provider = llmConfig?.provider || 'ollama';
      const axios = require('axios');

      const groupsDescription = elementGroups.map((group, index) => {
        const sampleText = group.sampleTexts.slice(0, 2).filter((t: string) => t && t.trim().length > 0).join(' | ');
        const hasContent = sampleText.length > 0;
        const contentPreview = hasContent ? sampleText : '(no text content - likely images/icons)';

        return `Group ${index}:
- Tag: ${group.fingerprint.tagName}
- Count: ${group.count} similar elements
- Has text content: ${hasContent ? 'YES' : 'NO'}
- Sample content: ${contentPreview.substring(0, 300)}`;
      }).join('\n\n');

      const systemPrompt = `You are a request classifier for list extraction. Your job is to:
1. Identify that the user wants to extract a list of items
2. Select the BEST element group that matches what they want
3. Extract any numeric limit from their request

CRITICAL GROUP SELECTION RULES:
- Match the sample content to what the user is asking for - this is the PRIMARY criterion
- Groups with text content are often easier to match, but image galleries, icon grids, or data-attribute based groups can also be correct
- Analyze the keywords in the user's request and find the group whose sample content or structure best matches
- Consider the context: product sites may have image grids, job sites have text listings, etc.
- The group with the most relevant content should be selected, NOT just the first group or the group with most text

LIMIT EXTRACTION:
- Look for numbers in the request that indicate quantity (e.g., "50", "25", "100", "first 30", "top 10")
- If no limit specified, use null

Must return valid JSON: {"actionType": "captureList", "reasoning": "...", "selectedGroupIndex": NUMBER, "limit": NUMBER_OR_NULL}`;

      const userPrompt = `User's request: "${prompt}"

Available element groups on page:
${groupsDescription}

TASK:
1. Identify the key terms from the user's request
2. Look through ALL the groups above
3. Find the group whose "Sample content" best matches the key terms from the request
4. Prefer groups with "Has text content: YES" over "NO"
5. Extract any numeric limit from the request if present

Return JSON:
{
  "actionType": "captureList",
  "reasoning": "Brief explanation of why this group was selected",
  "selectedGroupIndex": INDEX_NUMBER,
  "limit": NUMBER_OR_NULL
}

Note: selectedGroupIndex must be between 0 and ${elementGroups.length - 1}`;


      let llmResponse: string;

      if (provider === 'ollama') {
        const ollamaBaseUrl = llmConfig?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        const ollamaModel = llmConfig?.model || 'llama3.2-vision';

        const jsonSchema = {
          type: 'object',
          required: ['actionType', 'reasoning', 'selectedGroupIndex'],
          properties: {
            actionType: {
              type: 'string',
              enum: ['captureList']
            },
            reasoning: {
              type: 'string'
            },
            selectedGroupIndex: {
              type: 'integer'
            },
            limit: {
              type: ['integer', 'null']
            }
          }
        };

        const response = await axios.post(`${ollamaBaseUrl}/api/chat`, {
          model: ollamaModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt,
              images: [screenshotBase64]
            }
          ],
          stream: false,
          format: jsonSchema,
          options: {
            temperature: 0.1
          }
        });

        llmResponse = response.data.message.content;

      } else if (provider === 'anthropic') {
        const anthropic = new Anthropic({
          apiKey: llmConfig?.apiKey || process.env.ANTHROPIC_API_KEY
        });
        const anthropicModel = llmConfig?.model || 'claude-3-5-sonnet-20241022';

        const response = await anthropic.messages.create({
          model: anthropicModel,
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: screenshotBase64
                }
              },
              {
                type: 'text',
                text: userPrompt
              }
            ]
          }],
          system: systemPrompt
        });

        const textContent = response.content.find((c: any) => c.type === 'text');
        llmResponse = textContent?.type === 'text' ? textContent.text : '';

      } else if (provider === 'openai') {
        const openaiBaseUrl = llmConfig?.baseUrl || 'https://api.openai.com/v1';
        const openaiModel = llmConfig?.model || 'gpt-4-vision-preview';

        const response = await axios.post(`${openaiBaseUrl}/chat/completions`, {
          model: openaiModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: userPrompt
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${screenshotBase64}`
                  }
                }
              ]
            }
          ],
          max_tokens: 1024,
          temperature: 0.1
        }, {
          headers: {
            'Authorization': `Bearer ${llmConfig?.apiKey || process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        llmResponse = response.data.choices[0].message.content;

      } else {
        throw new Error(`Unsupported LLM provider: ${provider}`);
      }

      logger.info(`LLM Response: ${llmResponse}`);

      let jsonStr = llmResponse.trim();

      const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/) || jsonStr.match(/```\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const objectMatch = jsonStr.match(/\{[\s\S]*"actionType"[\s\S]*\}/);
      if (objectMatch) {
        jsonStr = objectMatch[0];
      }

      const decision = JSON.parse(jsonStr);

      if (!decision.actionType || decision.actionType !== 'captureList') {
        throw new Error('LLM response must have actionType: "captureList"');
      }

      if (decision.selectedGroupIndex === undefined || decision.selectedGroupIndex < 0 || decision.selectedGroupIndex >= elementGroups.length) {
        throw new Error(`Invalid selectedGroupIndex: ${decision.selectedGroupIndex}. Must be between 0 and ${elementGroups.length - 1}`);
      }

      const selectedGroup = elementGroups[decision.selectedGroupIndex];
      return {
        actionType: 'captureList',
        selectedGroup,
        itemSelector: selectedGroup.xpath,
        reasoning: decision.reasoning,
        limit: decision.limit || null
      };

    } catch (error: any) {
      logger.error('LLM decision error:', error);
      return this.fallbackHeuristicDecision(prompt, elementGroups);
    }
  }

  /**
   * Fallback heuristic decision when LLM fails
   */
  private static fallbackHeuristicDecision(prompt: string, elementGroups: any[]): any {
    const promptLower = prompt.toLowerCase();

    if (elementGroups.length === 0) {
      throw new Error('No element groups found on page for list extraction');
    }

    const scoredGroups = elementGroups.map((group, index) => {
      let score = 0;
      for (const sampleText of group.sampleTexts) {
        const keywords = promptLower.split(' ').filter((w: string) => w.length > 3);
        for (const keyword of keywords) {
          if (sampleText.toLowerCase().includes(keyword)) score += 2;
        }
      }
      score += Math.min(group.count / 10, 5);
      return { group, score, index };
    });

    scoredGroups.sort((a, b) => b.score - a.score);
    const best = scoredGroups[0];

    return {
      actionType: 'captureList',
      selectedGroup: best.group,
      itemSelector: best.group.xpath
    };
  }

  /**
   * Generate semantic field labels using LLM based on content and context
   */
  private static async generateFieldLabels(
    fields: Record<string, any>,
    fieldSamples: Record<string, string[]>,
    prompt: string,
    url: string,
    llmConfig?: {
      provider?: 'anthropic' | 'openai' | 'ollama';
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    }
  ): Promise<Record<string, string>> {
    try {
      const provider = llmConfig?.provider || 'ollama';

      const BATCH_SIZE = provider === 'ollama' ? 25 : 50;

      const fieldEntries = Object.entries(fieldSamples);
      const totalFields = fieldEntries.length;

      logger.info(`Processing ${totalFields} fields in batches of ${BATCH_SIZE} for LLM labeling`);

      const allLabels: Record<string, string> = {};

      for (let i = 0; i < fieldEntries.length; i += BATCH_SIZE) {
        const batch = fieldEntries.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(fieldEntries.length / BATCH_SIZE);

        logger.info(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} fields)`);

        const batchLabels = await this.generateFieldLabelsBatch(
          fields,
          Object.fromEntries(batch),
          prompt,
          url,
          llmConfig,
          allLabels
        );

        Object.assign(allLabels, batchLabels);
      }

      logger.info(`Completed labeling for ${Object.keys(allLabels).length}/${totalFields} fields`);

      return allLabels;
    } catch (error: any) {
      logger.error(`Error generating field labels with LLM: ${error.message}`);
      logger.error(`Using fallback: keeping generic field labels`);
      const fallbackLabels: Record<string, string> = {};
      Object.keys(fields).forEach(label => {
        fallbackLabels[label] = label;
      });
      return fallbackLabels;
    }
  }

  private static async generateFieldLabelsBatch(
    allFields: Record<string, any>,
    fieldSamplesBatch: Record<string, string[]>,
    prompt: string,
    url: string,
    llmConfig?: {
      provider?: 'anthropic' | 'openai' | 'ollama';
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    },
    previousLabels?: Record<string, string>
  ): Promise<Record<string, string>> {
    try {
      const provider = llmConfig?.provider || 'ollama';
      const axios = require('axios');

      const fieldDescriptions = Object.entries(fieldSamplesBatch).map(([genericLabel, samples]) => {
        const fieldInfo = allFields[genericLabel];
        const tagType = fieldInfo?.tag?.toLowerCase() || 'unknown';
        const attribute = fieldInfo?.attribute || 'innerText';

        let typeHint = '';
        if (attribute === 'href') typeHint = '(link/URL)';
        else if (attribute === 'src') typeHint = '(image)';
        else if (tagType === 'img') typeHint = '(image)';
        else if (tagType === 'a') typeHint = '(link)';

        return `${genericLabel}:
  Type: ${tagType} ${typeHint}
  Attribute: ${attribute}
  Sample values:
${samples.slice(0, 3).map((s, i) => `    ${i + 1}. "${s}"`).join('\n')}`;
      }).join('\n\n');

      const hasPreviousLabels = previousLabels && Object.keys(previousLabels).length > 0;
      const previousLabelsText = hasPreviousLabels
        ? `\n\nPREVIOUSLY ASSIGNED LABELS (from earlier batches):\n${Object.entries(previousLabels!).map(([orig, sem]) => `- "${sem}"`).join('\n')}\n\nIMPORTANT: DO NOT reuse these exact labels. Use them as context to maintain consistent naming patterns and avoid duplicates. Add qualifiers like "Secondary", "Alternative", numbers, or additional context to distinguish similar fields.`
        : '';

      const systemPrompt = `You are a data field labeling assistant. Your job is to generate clear, semantic field names for extracted data based on the user's request and the actual field content.

RULES FOR FIELD NAMING:
1. Use clear, descriptive names that match the content and context
2. Keep names concise (2-4 words maximum)
3. Use Title Case for field names
4. Match the user's terminology when possible
5. Be specific - include context when needed (e.g., "Product Name", "Job Title", "Article Headline", "Company Name")
6. For images, include "Image" or "Photo" in the name (e.g., "Product Image", "Profile Photo", "Thumbnail")
7. For links/URLs, you can use "URL" or "Link" (e.g., "Details Link", "Company Website")
8. Avoid generic terms like "Text", "Field", "Data" unless absolutely necessary
9. If you can't determine the meaning, use a descriptive observation based on the content type
10. Adapt to the domain: e-commerce (Product, Price), jobs (Title, Company), articles (Headline, Author), etc.
11. CRITICAL: Check previously assigned labels to avoid duplicates and maintain consistent naming patterns${previousLabelsText}

You must return a JSON object mapping each generic label to its semantic name.`;

      const userPrompt = `URL: ${url}

User's extraction request: "${prompt}"

Detected fields with sample data:
${fieldDescriptions}

TASK: Generate a semantic name for each field that accurately describes what it contains.
Consider:
- What the user is trying to extract (from their request)
- The actual content in the sample values
- The HTML element type and attribute being extracted
- Common naming conventions for this type of data

Return a JSON object with this exact structure:
{
  "Label 1": "Semantic Field Name 1",
  "Label 2": "Semantic Field Name 2",
  ...
}`;

      let llmResponse: string;

      if (provider === 'ollama') {
        const ollamaBaseUrl = llmConfig?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        const ollamaModel = llmConfig?.model || 'llama3.2-vision';

        logger.info(`Using Ollama at ${ollamaBaseUrl} with model ${ollamaModel}`);

        const jsonSchema = {
          type: 'object',
          required: ['fieldLabels'],
          properties: {
            fieldLabels: {
              type: 'object',
              description: 'Mapping of generic labels to semantic field names',
              patternProperties: {
                '^Label \\d+$': {
                  type: 'string',
                  description: 'Semantic field name in Title Case'
                }
              }
            }
          }
        };

        try {
          const response = await axios.post(`${ollamaBaseUrl}/api/chat`, {
            model: ollamaModel,
            messages: [
              {
                role: 'system',
                content: systemPrompt
              },
              {
                role: 'user',
                content: userPrompt
              }
            ],
            stream: false,
            format: jsonSchema,
            options: {
              temperature: 0.1,
              top_p: 0.9
            }
          });

          llmResponse = response.data.message.content;
        } catch (ollamaError: any) {
          logger.error(`Ollama request failed: ${ollamaError.message}`);
          if (ollamaError.response) {
            logger.error(`Ollama response status: ${ollamaError.response.status}`);
            logger.error(`Ollama response data: ${JSON.stringify(ollamaError.response.data)}`);
          }
          throw new Error(`Ollama API error: ${ollamaError.message}. Make sure Ollama is running at ${ollamaBaseUrl}`);
        }

      } else if (provider === 'anthropic') {
        const anthropic = new Anthropic({
          apiKey: llmConfig?.apiKey || process.env.ANTHROPIC_API_KEY
        });
        const anthropicModel = llmConfig?.model || 'claude-3-5-sonnet-20241022';

        const response = await anthropic.messages.create({
          model: anthropicModel,
          max_tokens: 2048,
          temperature: 0.1,
          messages: [{
            role: 'user',
            content: userPrompt
          }],
          system: systemPrompt
        });

        const textContent = response.content.find((c: any) => c.type === 'text');
        llmResponse = textContent?.type === 'text' ? textContent.text : '';

      } else if (provider === 'openai') {
        const openaiBaseUrl = llmConfig?.baseUrl || 'https://api.openai.com/v1';
        const openaiModel = llmConfig?.model || 'gpt-4o-mini';

        const response = await axios.post(`${openaiBaseUrl}/chat/completions`, {
          model: openaiModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          max_tokens: 2048,
          temperature: 0.1,
          response_format: { type: 'json_object' }
        }, {
          headers: {
            'Authorization': `Bearer ${llmConfig?.apiKey || process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        llmResponse = response.data.choices[0].message.content;

      } else {
        throw new Error(`Unsupported LLM provider: ${provider}`);
      }

      let jsonStr = llmResponse.trim();

      const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/) || jsonStr.match(/```\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonStr = objectMatch[0];
      }

      const parsedResponse = JSON.parse(jsonStr);

      let labelMapping: Record<string, string>;
      if (parsedResponse.fieldLabels) {
        labelMapping = parsedResponse.fieldLabels;
      } else {
        labelMapping = parsedResponse;
      }

      const missingLabels: string[] = [];
      Object.keys(fieldSamplesBatch).forEach(genericLabel => {
        if (!labelMapping[genericLabel]) {
          missingLabels.push(genericLabel);
        }
      });

      if (missingLabels.length > 0) {
        logger.warn(`LLM did not provide labels for: ${missingLabels.join(', ')}`);
        missingLabels.forEach(label => {
          labelMapping[label] = label;
        });
      }

      return labelMapping;
    } catch (error: any) {
      logger.error(`Error in batch field labeling: ${error.message}`);
      const fallbackLabels: Record<string, string> = {};
      Object.keys(fieldSamplesBatch).forEach(label => {
        fallbackLabels[label] = label;
      });
      return fallbackLabels;
    }
  }

  /**
   * Filter fields based on user intent using LLM with confidence scoring
   */
  private static async filterFieldsByIntent(
    labeledFields: Record<string, any>,
    fieldSamples: Record<string, string[]>,
    prompt: string,
    llmConfig?: {
      provider?: 'anthropic' | 'openai' | 'ollama';
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    }
  ): Promise<{
    selectedFields: Record<string, any>;
    confidence: number;
    reasoning: string;
    needsUserConfirmation: boolean;
  }> {
    try {
      const provider = llmConfig?.provider || 'ollama';
      const axios = require('axios');

      const fieldDescriptions = Object.entries(labeledFields).map(([fieldName, fieldInfo]) => {
        const samples = fieldSamples[fieldName] || [];
        const sampleText = samples.length > 0
          ? samples.slice(0, 1).map((s, i) => `"${s.substring(0, 100)}"`).join(', ')
          : '(no samples)';

        return `${fieldName}: ${fieldInfo.tag || 'unknown'} - ${sampleText}`;
      }).join('\n');

      const systemPrompt = `You are a field filter assistant. Your job is to analyze the user's extraction request and select ONLY the fields that match their intent.

CRITICAL RULES:
1. Only include fields explicitly mentioned or clearly implied by the user's request
2. Use semantic matching (e.g., "quotes" matches "Quote Text", "company names" matches "Company Name")
3. If the user specifies a count (e.g., "20 quotes"), note it but return the matching fields
4. Be strict: when in doubt, exclude the field rather than include it
5. Return high confidence (0.9-1.0) only if matches are exact or obvious
6. Return medium confidence (0.6-0.8) if matches are semantic/implied
7. Return low confidence (<0.6) if uncertain

You must return a JSON object with selectedFields, confidence, and reasoning.`;

      const userPrompt = `User's extraction request: "${prompt}"

Available labeled fields:
${fieldDescriptions}

TASK: Determine which fields the user wants to extract based on their request.

Return a JSON object with this exact structure:
{
  "selectedFields": ["Field Name 1", "Field Name 2"],
  "confidence": 0.95,
  "reasoning": "Brief explanation of why these fields were selected and confidence level"
}

Rules:
- selectedFields: Array of field names that match the user's intent
- confidence: Number between 0 and 1 (1.0 = exact match, 0.8+ = semantic match, <0.7 = uncertain)
- reasoning: Explain which keywords from the user's request matched which fields`;

      let llmResponse: string;

      if (provider === 'ollama') {
        const ollamaBaseUrl = llmConfig?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        const ollamaModel = llmConfig?.model || 'llama3.2-vision';

        const jsonSchema = {
          type: 'object',
          required: ['selectedFields', 'confidence', 'reasoning'],
          properties: {
            selectedFields: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of field names that match user intent'
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Confidence score from 0 to 1'
            },
            reasoning: {
              type: 'string',
              description: 'Explanation of field selection and confidence'
            }
          }
        };

        const response = await axios.post(`${ollamaBaseUrl}/api/chat`, {
          model: ollamaModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          stream: false,
          format: jsonSchema,
          options: {
            temperature: 0.1,
            top_p: 0.9
          }
        });

        llmResponse = response.data.message.content;

      } else if (provider === 'anthropic') {
        const anthropic = new Anthropic({
          apiKey: llmConfig?.apiKey || process.env.ANTHROPIC_API_KEY
        });
        const anthropicModel = llmConfig?.model || 'claude-3-5-sonnet-20241022';

        const response = await anthropic.messages.create({
          model: anthropicModel,
          max_tokens: 1024,
          temperature: 0.1,
          messages: [{
            role: 'user',
            content: userPrompt
          }],
          system: systemPrompt
        });

        const textContent = response.content.find((c: any) => c.type === 'text');
        llmResponse = textContent?.type === 'text' ? textContent.text : '';

      } else if (provider === 'openai') {
        const openaiBaseUrl = llmConfig?.baseUrl || 'https://api.openai.com/v1';
        const openaiModel = llmConfig?.model || 'gpt-4o-mini';

        const response = await axios.post(`${openaiBaseUrl}/chat/completions`, {
          model: openaiModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          max_tokens: 1024,
          temperature: 0.1,
          response_format: { type: 'json_object' }
        }, {
          headers: {
            'Authorization': `Bearer ${llmConfig?.apiKey || process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        llmResponse = response.data.choices[0].message.content;

      } else {
        throw new Error(`Unsupported LLM provider: ${provider}`);
      }

      logger.info(`LLM Field Filtering Response: ${llmResponse}`);

      // Parse JSON response
      let jsonStr = llmResponse.trim();

      const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/) || jsonStr.match(/```\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonStr = objectMatch[0];
      }

      const filterResult = JSON.parse(jsonStr);

      if (!Array.isArray(filterResult.selectedFields)) {
        throw new Error('Invalid response: selectedFields must be an array');
      }

      if (typeof filterResult.confidence !== 'number' || filterResult.confidence < 0 || filterResult.confidence > 1) {
        throw new Error('Invalid response: confidence must be a number between 0 and 1');
      }

      const filteredFields: Record<string, any> = {};
      for (const fieldName of filterResult.selectedFields) {
        if (labeledFields[fieldName]) {
          filteredFields[fieldName] = labeledFields[fieldName];
        } else {
          logger.warn(`LLM selected field "${fieldName}" but it doesn't exist in labeled fields`);
        }
      }

      const needsUserConfirmation = filterResult.confidence < 0.8 || Object.keys(filteredFields).length === 0;

      return {
        selectedFields: filteredFields,
        confidence: filterResult.confidence,
        reasoning: filterResult.reasoning || 'No reasoning provided',
        needsUserConfirmation
      };

    } catch (error: any) {
      logger.error(`Error filtering fields by intent: ${error.message}`);
      
      return {
        selectedFields: labeledFields,
        confidence: 0.5,
        reasoning: 'Error during filtering, returning all fields as fallback',
        needsUserConfirmation: true
      };
    }
  }

  /**
   * Extract sample data from fields for LLM labeling
   */
  private static async extractFieldSamples(
    fields: Record<string, any>,
    listSelector: string,
    validator: SelectorValidator
  ): Promise<Record<string, string[]>> {
    const fieldSamples: Record<string, string[]> = {};

    try {
      const page = (validator as any).page;
      if (!page) {
        throw new Error('Page not available');
      }

      const samples = await page.evaluate((args: { fieldsData: any; listSel: string }) => {
        const results: Record<string, string[]> = {};

        function evaluateSelector(selector: string, doc: Document): Element[] {
          const isXPath = selector.startsWith('//') || selector.startsWith('(//');
          if (isXPath) {
            const result = doc.evaluate(selector, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const elements: Element[] = [];
            for (let i = 0; i < result.snapshotLength; i++) {
              const node = result.snapshotItem(i);
              if (node && node.nodeType === Node.ELEMENT_NODE) {
                elements.push(node as Element);
              }
            }
            return elements;
          } else {
            return Array.from(doc.querySelectorAll(selector));
          }
        }

        const listItems = evaluateSelector(args.listSel, document).slice(0, 5);

        Object.entries(args.fieldsData).forEach(([fieldLabel, fieldInfo]: [string, any]) => {
          const samples: string[] = [];
          const selector = fieldInfo.selector;
          const attribute = fieldInfo.attribute || 'innerText';

          listItems.forEach((listItem: Element) => {
            try {
              const elements = evaluateSelector(selector, document);

              const matchingElement = elements.find((el: Element) => {
                return listItem.contains(el);
              });

              if (matchingElement) {
                let value = '';
                if (attribute === 'innerText') {
                  value = (matchingElement.textContent || '').trim();
                } else {
                  value = matchingElement.getAttribute(attribute) || '';
                }

                if (value && value.length > 0 && !samples.includes(value)) {
                  samples.push(value.substring(0, 200));
                }
              }
            } catch (e) {
            }
          });

          results[fieldLabel] = samples;
        });

        return results;
      }, { fieldsData: fields, listSel: listSelector });

      return samples;
    } catch (error: any) {
      logger.error(`Error extracting field samples: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
      Object.keys(fields).forEach(label => {
        fieldSamples[label] = [];
      });
      return fieldSamples;
    }
  }

  /**
   * Generate semantic list name using LLM based on user prompt and field context
   */
  private static async generateListName(
    prompt: string,
    url: string,
    fieldNames: string[],
    llmConfig?: {
      provider?: 'anthropic' | 'openai' | 'ollama';
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    }
  ): Promise<string> {
    try {
      const provider = llmConfig?.provider || 'ollama';
      const axios = require('axios');

      const fieldContext = fieldNames.length > 0
        ? `\n\nDetected fields in the list:\n${fieldNames.slice(0, 10).map((name, idx) => `${idx + 1}. ${name}`).join('\n')}`
        : '';

      const systemPrompt = `You are a list naming assistant. Your job is to generate a clear, concise name for a data list based on the user's extraction request and the fields being extracted.

RULES FOR LIST NAMING:
1. Use 1-3 words maximum (prefer 2 words)
2. Use Title Case (e.g., "Product Listings", "Job Postings")
3. Be specific and descriptive
4. Match the user's terminology when possible
5. Adapt to the domain: e-commerce (Products, Listings), jobs (Jobs, Postings), articles (Articles, News), etc.
6. Avoid generic terms like "List", "Data", "Items" unless absolutely necessary
7. Focus on WHAT is being extracted, not HOW

Examples:
- User wants "product listings" → "Product Listings" or "Products"
- User wants "job postings" → "Job Postings" or "Jobs"
- User wants "article titles" → "Articles"
- User wants "company information" → "Companies"
- User wants "quotes from page" → "Quotes"

You must return ONLY the list name, nothing else. No JSON, no explanation, just the name.`;

      const userPrompt = `URL: ${url}

User's extraction request: "${prompt}"
${fieldContext}

TASK: Generate a concise, descriptive name for this list (1-3 words in Title Case).

Return ONLY the list name, nothing else:`;

      let llmResponse: string;

      if (provider === 'ollama') {
        const ollamaBaseUrl = llmConfig?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        const ollamaModel = llmConfig?.model || 'llama3.2-vision';

        try {
          const response = await axios.post(`${ollamaBaseUrl}/api/chat`, {
            model: ollamaModel,
            messages: [
              {
                role: 'system',
                content: systemPrompt
              },
              {
                role: 'user',
                content: userPrompt
              }
            ],
            stream: false,
            options: {
              temperature: 0.1,
              top_p: 0.9,
              num_predict: 20
            }
          });

          llmResponse = response.data.message.content;
        } catch (ollamaError: any) {
          logger.error(`Ollama request failed for list naming: ${ollamaError.message}`);
          logger.info('Using fallback list name: "List 1"');
          return 'List 1';
        }
      } else if (provider === 'anthropic') {
        const anthropic = new Anthropic({
          apiKey: llmConfig?.apiKey || process.env.ANTHROPIC_API_KEY
        });
        const anthropicModel = llmConfig?.model || 'claude-3-5-sonnet-20241022';

        const response = await anthropic.messages.create({
          model: anthropicModel,
          max_tokens: 20,
          temperature: 0.1,
          messages: [{
            role: 'user',
            content: userPrompt
          }],
          system: systemPrompt
        });

        const textContent = response.content.find((c: any) => c.type === 'text');
        llmResponse = textContent?.type === 'text' ? textContent.text : '';

      } else if (provider === 'openai') {
        const openaiBaseUrl = llmConfig?.baseUrl || 'https://api.openai.com/v1';
        const openaiModel = llmConfig?.model || 'gpt-4o-mini';

        const response = await axios.post(`${openaiBaseUrl}/chat/completions`, {
          model: openaiModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          max_tokens: 20,
          temperature: 0.1
        }, {
          headers: {
            'Authorization': `Bearer ${llmConfig?.apiKey || process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        llmResponse = response.data.choices[0].message.content;
      } else {
        throw new Error(`Unsupported LLM provider: ${provider}`);
      }

      let listName = (llmResponse || '').trim();
      logger.info(`LLM List Naming Response: "${listName}"`);

      listName = listName.replace(/^["']|["']$/g, '');
      listName = listName.split('\n')[0];
      listName = listName.trim();

      if (!listName || listName.length === 0) {
        throw new Error('LLM returned empty list name');
      }

      if (listName.length > 50) {
        throw new Error('LLM returned list name that is too long');
      }

      listName = listName.split(' ')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

      logger.info(`✓ Generated list name: "${listName}"`);
      return listName;
    } catch (error: any) {
      logger.error(`Error in generateListName: ${error.message}`);
      logger.info('Using fallback list name: "List 1"');
      return 'List 1';
    }
  }

  /**
   * Build workflow from LLM decision
   */
  private static async buildWorkflowFromLLMDecision(
    llmDecision: any,
    url: string,
    validator: SelectorValidator,
    prompt?: string,
    llmConfig?: {
      provider?: 'anthropic' | 'openai' | 'ollama';
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    }
  ): Promise<any[]> {
    const workflow: any[] = [];

    workflow.push({
      where: { url, selectors: [] },
      what: [
        { action: 'goto', args: [url] },
        { action: 'waitForLoadState', args: ['networkidle'] }
      ]
    });

    if (llmDecision.actionType === 'captureList') {
      const autoDetectResult = await validator.autoDetectListFields(llmDecision.itemSelector);

      if (!autoDetectResult.success || !autoDetectResult.fields || Object.keys(autoDetectResult.fields).length === 0) {
        throw new Error('Failed to auto-detect fields from selected group');
      }

      logger.info('Extracting field samples and detecting pagination in parallel...');
      const [fieldSamples, paginationResult] = await Promise.all([
        this.extractFieldSamples(
          autoDetectResult.fields,
          autoDetectResult.listSelector || '',
          validator
        ),
        validator.autoDetectPagination(llmDecision.itemSelector).catch((error: any) => {
          logger.warn('Pagination auto-detection failed:', error.message);
          return { success: false, type: 'none', selector: '' };
        })
      ]);

      logger.info('Generating semantic field labels with LLM...');
      const fieldLabels = await this.generateFieldLabels(
        autoDetectResult.fields,
        fieldSamples,
        prompt || 'Extract list data',
        url,
        llmConfig
      );

      const renamedFields: Record<string, any> = {};
      Object.entries(autoDetectResult.fields).forEach(([genericLabel, fieldInfo]) => {
        const semanticLabel = fieldLabels[genericLabel] || genericLabel;
        renamedFields[semanticLabel] = fieldInfo;
      });
      
      const renamedSamples: Record<string, string[]> = {};
      Object.entries(fieldSamples).forEach(([genericLabel, samples]) => {
        const semanticLabel = fieldLabels[genericLabel] || genericLabel;
        renamedSamples[semanticLabel] = samples;
      });

      const filterResult = await this.filterFieldsByIntent(
        renamedFields,
        renamedSamples,
        prompt || 'Extract list data',
        llmConfig
      );

      let finalFields = renamedFields;
      if (filterResult.confidence >= 0.8 && Object.keys(filterResult.selectedFields).length > 0) {
        finalFields = filterResult.selectedFields;
      } else if (filterResult.confidence >= 0.6 && Object.keys(filterResult.selectedFields).length > 0) {
        finalFields = filterResult.selectedFields;
      } else {
        logger.warn(`Low confidence (${filterResult.confidence}) or no fields selected. Using all detected fields as fallback.`);
      }

      let paginationType = 'none';
      let paginationSelector = '';

      if (paginationResult.success && paginationResult.type) {
        paginationType = paginationResult.type;
        paginationSelector = paginationResult.selector || '';
      }

      const limit = llmDecision.limit || 100;
      logger.info(`Using limit: ${limit}`);

      logger.info('Generating semantic list name with LLM...');
      const listName = await this.generateListName(
        prompt || 'Extract list data',
        url,
        Object.keys(finalFields),
        llmConfig
      );
      logger.info(`Using list name: "${listName}"`);

      workflow[0].what.push({
        action: 'scrapeList',
        actionId: `list-${uuid()}`,
        name: listName,
        args: [{
          fields: finalFields,
          listSelector: autoDetectResult.listSelector,
          pagination: {
            type: paginationType,
            selector: paginationSelector
          },
          limit: limit
        }]
      });

      workflow[0].what.push({
        action: 'waitForLoadState',
        args: ['networkidle']
      });
    } else {
      throw new Error(`Unsupported action type: ${llmDecision.actionType}. Only captureList is supported.`);
    }

    return workflow;
  }
}