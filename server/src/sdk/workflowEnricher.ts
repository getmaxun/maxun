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
              logger.info('Auto-detected', Object.keys(enrichedFields).length, 'fields');
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
    llmConfig?: {
      provider?: 'anthropic' | 'openai' | 'ollama';
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    },
    userId: string = 'sdk-validation-user',
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
      const screenshotBuffer = await page.screenshot({ fullPage: true, type: 'png' });
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

      const workflow = await this.buildWorkflowFromLLMDecision(llmDecision, url, validator);

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
- Groups with "Has text content: YES" are usually better than groups with NO text content
- Match the sample content to what the user is asking for
- Avoid groups that only show images/icons (Has text content: NO)
- The group with the most relevant sample content should be selected, NOT just the first group
- Analyze the keywords in the user's request and find the group whose sample content contains related text

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
   * Build workflow from LLM decision
   */
  private static async buildWorkflowFromLLMDecision(
    llmDecision: any,
    url: string,
    validator: SelectorValidator
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
      logger.info(`Auto-detecting fields for: ${llmDecision.itemSelector}`);

      const autoDetectResult = await validator.autoDetectListFields(llmDecision.itemSelector);

      if (!autoDetectResult.success || !autoDetectResult.fields || Object.keys(autoDetectResult.fields).length === 0) {
        throw new Error('Failed to auto-detect fields from selected group');
      }

      logger.info(`Auto-detected ${Object.keys(autoDetectResult.fields).length} fields`);

      let paginationType = 'none';
      let paginationSelector = '';

      try {
        const paginationResult = await validator.autoDetectPagination(llmDecision.itemSelector);
        if (paginationResult.success && paginationResult.type) {
          paginationType = paginationResult.type;
          paginationSelector = paginationResult.selector || '';
        }
      } catch (error: any) {
        logger.warn('Pagination auto-detection failed:', error.message);
      }

      const limit = llmDecision.limit || 100;
      logger.info(`Using limit: ${limit}`);

      workflow[0].what.push({
        action: 'scrapeList',
        actionId: `list-${uuid()}`,
        name: 'List 1',
        args: [{
          fields: autoDetectResult.fields,
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