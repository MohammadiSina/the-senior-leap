#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Command } = require('commander');
const OllamaAdapter = require('./adapters/ollama');
const AnthropicAdapter = require('./adapters/anthropic');
const OpenRouterAdapter = require('./adapters/openrouter');

const program = new Command();

// Parse CLI arguments to get the exercise path
program
  .requiredOption('-e, --exercise <path>', 'Relative path to the exercise folder')
  .parse(process.argv);

const options = program.opts();
const exercisePath = path.resolve(process.cwd(), options.exercise);

// Load configuration from config.yml
function loadConfig() {
  const configPath = path.join(__dirname, 'config.yml');
  if (!fs.existsSync(configPath)) {
    console.error(
      'Error: config.yml not found. Copy config.example.yml to config.yml and set your provider.',
    );
    process.exit(1);
  }
  return yaml.load(fs.readFileSync(configPath, 'utf8'));
}

// Read required markdown files from the exercise directory
function readExerciseFiles() {
  const rubricPath = path.join(exercisePath, 'rubric.md');
  const analysisPath = path.join(exercisePath, 'my-analysis.md');
  const systemPromptPath = path.join(__dirname, 'prompts', 'system.md');

  if (!fs.existsSync(rubricPath) || !fs.existsSync(analysisPath)) {
    console.error('Error: Missing rubric.md or my-analysis.md in the exercise folder.');
    process.exit(1);
  }

  return {
    rubric: fs.readFileSync(rubricPath, 'utf8'),
    analysis: fs.readFileSync(analysisPath, 'utf8'),
    systemPrompt: fs.readFileSync(systemPromptPath, 'utf8'),
  };
}

async function main() {
  const config = loadConfig();
  const files = readExerciseFiles();

  // Construct the user message combining rubric and analysis
  const userPrompt = `
# RUBRIC
${files.rubric}

# DEVELOPER ANALYSIS
${files.analysis}

Evaluate the analysis based on the rubric and provide your feedback using the exact required headings.
  `;

  // Instantiate the correct adapter based on config
  let adapter;
  switch (config.provider) {
    case 'ollama':
      adapter = new OllamaAdapter(config);
      break;
    case 'anthropic':
      adapter = new AnthropicAdapter(config);
      break;
    case 'openrouter':
      adapter = new OpenRouterAdapter(config);
      break;
    default:
      console.error(`Unsupported provider: ${config.provider}`);
      process.exit(1);
  }

  console.log(`\nEvaluating using ${config.provider} (${config.model})...\n`);

  try {
    // Run the evaluation
    const evaluation = await adapter.evaluate(files.systemPrompt, userPrompt);

    // Save to my-evaluation.md
    const outputPath = path.join(exercisePath, 'my-evaluation.md');
    fs.writeFileSync(outputPath, evaluation);

    // Print to terminal
    console.log(evaluation);
    console.log(`\n✅ Evaluation saved to ${outputPath}`);
  } catch (error) {
    console.error('Evaluation failed:', error.message);
  }
}

main();
