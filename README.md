# Gemini Deep Research

Test script for Google's Gemini Deep Research API (Interactions API).

## About

The Deep Research API is an autonomous research agent powered by Gemini 3 Pro. It:
- Plans and executes multi-step research tasks
- Iteratively searches the web via Google Search
- Synthesizes findings into comprehensive reports with citations
- Typically takes 5-15 minutes per research task

## Setup

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Create a `.env` file with your API key:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```

   Get your API key from [Google AI Studio](https://aistudio.google.com/apikey).

## Usage

```bash
# Run with default query
python deep_research.py

# Run with custom query
python deep_research.py "What is quantum computing?"
```

The script polls the Interactions API endpoint until research completes.

## API Details

- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/interactions`
- **Agent**: `deep-research-pro-preview-12-2025`
- **Execution**: Asynchronous (requires polling)
