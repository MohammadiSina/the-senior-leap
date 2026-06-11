const BaseAdapter = require('./base');

class GroqAdapter extends BaseAdapter {
  async evaluate(systemPrompt, userPrompt) {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const apiKey = this.config.api_key ? this.config.api_key.trim() : '';

    if (!apiKey) throw new Error('Groq API key is missing in config.yml');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    console.log(`Sending request to Groq (model: ${this.config.model})...`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3, // Lower temperature for more consistent rubric grading
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('Request timed out.');
      throw error;
    }
  }
}

module.exports = GroqAdapter;
