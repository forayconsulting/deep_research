# Gemini Deep Research

Test script for Google's Gemini Deep Research API (Interactions API).

## Setup

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Create a `.env` file with your API key:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```

## Usage

```bash
# Run with default query
python deep_research.py

# Run with custom query
python deep_research.py "What is quantum computing?"
```

The script will start a research task and poll until completion (may take several minutes).
