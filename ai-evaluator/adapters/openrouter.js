const BaseAdapter = require('./base');

class OpenRouterAdapter extends BaseAdapter {
  async evaluate(systemPrompt, userPrompt) {
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const apiKey = this.config.api_key ? this.config.api_key.trim() : '';

    if (!apiKey) throw new Error('OpenRouter API key is missing or empty in config.yml');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    console.log(`Sending request to OpenRouter (model: ${this.config.model})...`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/the-senior-leap',
          'X-Title': 'The Senior Leap',
          'Content-Type': 'application/json',
          Model: this.config.model,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(
          'Request timed out after 60 seconds. The model might be queued or rate-limited.',
        );
      }
      console.error('Fetch error details:', error.message);
      if (error.cause) {
        console.error('Underlying cause:', error.cause);
      }
      throw error;
    }
  }
}

module.exports = OpenRouterAdapter;
