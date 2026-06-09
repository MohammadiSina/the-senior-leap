# V8 Heap & Memory Profiling

> Already comfortable with garbage collection and Chrome DevTools heap snapshots? Skip this and go straight to `README.md`.

---

JavaScript objects live on the **heap** — a region of memory managed by V8's garbage collector. When no code can reach an object anymore, the GC is free to reclaim it. When an object sticks around when it shouldn't, that's a memory leak.

Understanding what "reachable" means is the whole game.

---

## How Garbage Collection Decides What to Keep

V8's GC starts from a set of **GC roots** — things that are always reachable: the global object, the current call stack, and a handful of internal runtime references. From there, it traces every reference: object properties, array elements, closure variables, anything that points at something else.

If there exists *any* path from a GC root to an object, that object is retained. If there's no such path, the object is unreachable and eligible for collection.

This has a non-obvious consequence: **a small thing keeping a reference to a large thing keeps the large thing alive**. A tiny callback function that closes over a large object is enough to prevent that object from ever being collected.

---

## EventEmitters and Listeners

`EventEmitter.on('event', fn)` appends `fn` to an internal listener array on the emitter. That array is a property of the emitter. If the emitter is reachable (which long-lived ones typically are), every listener it holds is also reachable, along with anything those listeners close over.

This is why `removeListener` / `off` exists. Until you call it, the listener — and everything its closure touches — stays alive.

Node.js has a built-in safeguard: when more than 10 listeners are registered on a single event, it emits a `MaxListenersExceededWarning`. The number isn't the problem — the warning is telling you that something is registering listeners without removing them.

---

## Taking a Heap Snapshot

Heap snapshots let you see exactly what's on the heap at a point in time and what's keeping each object alive.

**Start the server with the inspector enabled:**

```bash
node --inspect index.js
```

**Open Chrome and navigate to:**

```
chrome://inspect
```

Click **inspect** under your Node.js process. This opens a dedicated DevTools window for that process.

**Take a snapshot:**

1. Go to the **Memory** tab
2. Select **Heap snapshot**
3. Click **Take snapshot**

The snapshot appears in the left sidebar. Click it to explore.

---

## Comparing Two Snapshots

A single snapshot tells you what's on the heap. Two snapshots, compared, tell you what's *accumulating*.

1. Take a **baseline snapshot** before running load
2. Run the load simulator for 2–3 minutes
3. Take a **second snapshot**
4. In the second snapshot, use the dropdown (top-left of the snapshot panel, it probably says "Summary") and switch to **Comparison**
5. Sort by **# Delta** (descending) — this ranks object types by how many new instances appeared between snapshots

Look for object types with a large positive `# Delta` and a large `+Size`. Those are your suspects. Click into them to see the **retainer chain** — the path from a GC root to one of the retained objects — which tells you *why* it can't be collected.

---

## What to Watch For

- A closure retaining an object you didn't expect (check what variables it closes over)
- Many instances of the same object type, all sharing a common retainer
- The `MaxListenersExceededWarning` in your server logs — it means something is calling `on()` without a matching `off()`

---

## Further Reading

- [V8 blog: Memory Management](https://v8.dev/blog/trash-talk) — the GC team explaining how modern V8 GC actually works
- [Node.js docs: EventEmitter](https://nodejs.org/api/events.html#emittersetmaxlistenersncount) — `setMaxListeners`, `listenerCount`, and why the defaults are what they are
