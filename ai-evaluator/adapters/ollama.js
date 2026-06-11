const BaseAdapter = require('./base');

class OllamaAdapter extends BaseAdapter {
  async evaluate(systemPrompt, userPrompt) {
    const url = `${this.config.base_url}/api/generate`;

    // Ollama's generate endpoint takes a single prompt string, so we combine system and user
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        prompt: fullPrompt,
        stream: false, // We want the full response at once, not a stream
      }),
    });

    if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);

    const data = await response.json();
    return data.response;
  }
}

module.exports = OllamaAdapter;
