# The Senior Leap

> Hands-on exercises, rubrics, and AI-assisted evaluation for engineers closing the gap to senior.

---

## The Problem

AI writes a lot of code now. It can scaffold services, suggest an architecture, and walk through tradeoffs. Senior engineers spend less time writing and more time deciding - directing AI, reviewing outputs, making the architectural calls that are hard to walk back.

What AI can't do is bear the consequences. When a migration corrupts data, when a race condition surfaces under real load, when a deploy takes down a system with no obvious path back - someone has to have understood the risks well enough to prevent it, or recover fast. AI can generate the code. It doesn't have to live with what it generates.

That gap is what separates senior engineers from mid-level ones. A mid-level engineer builds something that works. A senior engineer builds it knowing what happens when it doesn't - and designs for that from the start. AI makes that distinction more visible, not less important.

**Most resources teach you *what* senior engineers know.\
This repo makes you practice *how* they think.**

---

## Getting Started

**Fork this repository** - your `my-analysis.md` files accumulate in your fork over time, which makes it a portfolio of your reasoning across real engineering scenarios.

```bash
git clone https://github.com/your-username/the-senior-leap
cd the-senior-leap
```

Pick a topic and start with an exercise. No global setup required - each exercise documents its own setup. Most runnable apps start with `npm install && node index.js`; multi-service exercises use Docker Compose.

---

## How It Works

Every exercise follows the same structure, regardless of topic:

```
topic/exercise-name/
├── README.md         ← the scenario and your task
├── tutorial.md       ← background, if the concept is new to you
├── my-analysis.md    ← write your findings here first
├── rubric.md         ← open after writing your analysis
├── app/              ← runnable app, where applicable
└── solution/         ← reference solution, where applicable
```

**The order matters:**

1. Read `README.md` - understand the scenario and your task
2. Read `tutorial.md` if the concept is new to you
3. Attempt the exercise
4. Write your reasoning in `my-analysis.md` before looking at anything else
5. Open `rubric.md` - see what a senior would have caught and why it matters
6. Optionally run the AI evaluator for a deeper conversation about your reasoning

The rubric is not a pass/fail test. It's written from the perspective of a senior engineer reviewing your analysis or your PR - the things they'd flag, the questions they'd ask, the failure modes you hadn't considered.

---

## Topics

| Topic             | What it targets                                                    |
| ----------------- | ------------------------------------------------------------------ |
| Node.js Internals | Code that looks async but blocks, leaks, or fails silently         |
| System Design     | Production constraints that break textbook solutions               |
| Concurrency       | State that corrupts only under specific timing                     |
| Docker            | Images and pipelines that quietly accumulate technical debt        |
| Databases         | Queries and writes that behave differently at scale                |
| Observability     | Incidents you can't reconstruct from what was logged               |
| Testing Strategy  | Test suites that pass while production is broken                   |
| Technical Writing | Real decisions documented with their tradeoffs intact              |
| Security          | Vulnerabilities that hide behind plausible-looking implementations |

---

## AI Evaluator

For open-ended exercises - especially system design - a static rubric has limits. You might reason correctly but miss an edge case, or make a defensible tradeoff you can't quite articulate.

The evaluator works entirely through files. Before running it, fill in your `my-analysis.md` - your findings, your reasoning, and anything you were uncertain about. The evaluator reads that file alongside the exercise rubric and returns structured feedback, including direct answers to whatever you flagged in your **Questions & Uncertainties** section.

```bash
cd ai-evaluator
cp config.example.yml config.yml
# Edit config.yml - set your provider and model
node evaluate.js --exercise ../system-design/queue-disaster
```

Feedback is printed to the terminal and saved as `my-evaluation.md` alongside your analysis. It covers:

- What you identified correctly
- What you missed and why it matters
- Direct answers to your stated questions
- One thing to focus on next

Supports local models through Ollama, plus cloud options including Anthropic, OpenRouter, and Groq.

See [`ai-evaluator/README.md`](./ai-evaluator/README.md) for full setup and configuration.

---

## Contributing

The best exercises come from real experience. If you've debugged a gnarly production issue, made a system design call you had to defend, or hit a Docker gotcha that taught you something - it probably belongs here.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the exercise template and what makes a good exercise.

---

## License

Licensed under the MIT License. See [`LICENSE`](./LICENSE) for details.