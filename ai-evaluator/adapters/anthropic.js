const BaseAdapter = require('./base');

class AnthropicAdapter extends BaseAdapter {
  async evaluate(systemPrompt, userPrompt) {
    const url = 'https://api.anthropic.com/v1/messages';

    if (!this.config.api_key) throw new Error('Anthropic API key is missing in config.yml');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.config.api_key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) throw new Error(`Anthropic API error: ${response.statusText}`);

    const data = await response.json();
    return data.content[0].text;
  }
}

module.exports = AnthropicAdapter;
