// llm.js — WebLLM integration (in-browser AI)

const LLM = {
  engine: null,
  model: 'Phi-3-mini-4k-instruct-q4f16_1-MLC',
  ready: false,
  loading: false,

  async init(onProgress) {
    if (this.loading || this.ready) return;
    this.loading = true;
    try {
      const { CreateMLCEngine } = await import(
        'https://esm.run/@mlc-ai/web-llm'
      );
      this.engine = await CreateMLCEngine(this.model, {
        initProgressCallback: onProgress || (() => {})
      });
      this.ready = true;
    } catch (err) {
      console.error('WebLLM init failed:', err);
      throw err;
    } finally {
      this.loading = false;
    }
  },

  async query(prompt, system = '') {
    if (!this.ready) return 'LLM not loaded yet.';
    const reply = await this.engine.chat.completions.create({
      messages: [
        { role: 'system', content: system || 'Be concise. Under 100 words.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 200
    });
    return reply.choices[0].message.content;
  },

  async summarizeChat(messages) {
    const last50 = messages.slice(-50).map(m => `${m.name}: ${m.text}`).join('\n');
    return this.query(`Summarize this chat in 3 bullets:\n${last50}`);
  },

  async reviewCode(code) {
    return this.query(
      `Review this code. Bugs? Improvements? Be brief.\n\`\`\`\n${code}\n\`\`\``
    );
  },

  async executeBloom(bloomPrompt, input) {
    return this.query(input, bloomPrompt);
  }
};

export default LLM;
