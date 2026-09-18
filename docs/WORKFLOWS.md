# Agent Workflows

One Router supports subgraph and DAG routing for agentic workflows, recognizing that different parts of a system require different inference capabilities.

## Workflow Example
A typical retrieval agent might be declared as:
- **Planner**: Highest-quality frontier model (e.g., Claude 3.5 Sonnet).
- **Retrieve/Extract**: Dozens of parallel extractions using a fast/cheap model (e.g., Llama 3 8B).
- **Validate**: Specialized schema-checking endpoint or local tiny model.

Currently, One Router natively recognizes **Tool Calls** and immediately filters the candidate pool to models that explicitly support function calling.
