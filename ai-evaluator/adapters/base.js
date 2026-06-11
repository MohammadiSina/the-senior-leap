// Base class ensuring all adapters implement the evaluate method
class BaseAdapter {
  constructor(config) {
    this.config = config;
  }

  async evaluate(systemPrompt, userPrompt) {
    throw new Error('evaluate() must be implemented by subclass');
  }
}

module.exports = BaseAdapter;
