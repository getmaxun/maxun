export class PromptOrchestrator {
  private static readonly BASE_SYSTEM_PROMPT = `You are an automated data extraction API. You must output pure, valid JSON and absolutely nothing else.
Do NOT wrap your response in markdown code fences (e.g., do not use \`\`\` or \`\`\`json).
Do NOT include greetings, explanations, thoughts, or introductory text.

Your task is to parse the document based strictly on the user instructions and context. 
Return a single JSON object where the keys represent the requested data points and values represent the exact extracted information.
Do not hallucinate, infer, or include outside information. If a field is missing from the document, set its value to null.`;

  public static buildPrompt(userInstructions: string, documentContext: string): string {
    return [
      this.BASE_SYSTEM_PROMPT,
      "--- DOCUMENT CONTEXT ---",
      documentContext,
      "--- INSTRUCTIONS ---",
      userInstructions.trim(),
    ].join('\n\n');
  }
}