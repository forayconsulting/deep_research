#!/usr/bin/env python3
"""
Gemini Deep Research API Test Script

Uses the Interactions API to run autonomous research tasks with Gemini.
"""

import argparse
import os
import sys
import time

from dotenv import load_dotenv
from google import genai

# Load environment variables
load_dotenv()

# Constants
AGENT_MODEL = "deep-research-pro-preview-12-2025"
POLL_INTERVAL = 10  # seconds


def create_client():
    """Create and return a Gemini API client."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY not found in environment variables.")
        print("Please set it in your .env file.")
        sys.exit(1)

    return genai.Client(api_key=api_key)


def run_research(client, query: str):
    """
    Start a deep research task and poll until completion.

    Args:
        client: The Gemini API client
        query: The research query/topic

    Returns:
        The research output text
    """
    print(f"\nStarting deep research on: {query}")
    print("-" * 50)

    # Start the research task (runs in background)
    interaction = client.interactions.create(
        input=query,
        agent=AGENT_MODEL,
        background=True
    )

    print(f"Research task started. ID: {interaction.id}")
    print("Polling for results (this may take several minutes)...\n")

    # Poll for completion
    start_time = time.time()
    while True:
        interaction = client.interactions.get(interaction.id)
        elapsed = int(time.time() - start_time)

        if interaction.status == "completed":
            print(f"\nResearch completed in {elapsed} seconds!")
            return interaction.outputs[-1].text

        elif interaction.status == "failed":
            error_msg = getattr(interaction, 'error', 'Unknown error')
            print(f"\nResearch failed after {elapsed} seconds: {error_msg}")
            return None

        else:
            # Still in progress
            print(f"  Status: {interaction.status} ({elapsed}s elapsed)")
            time.sleep(POLL_INTERVAL)


def main():
    parser = argparse.ArgumentParser(
        description="Run a deep research task using Gemini's Deep Research API"
    )
    parser.add_argument(
        "query",
        nargs="?",
        default="What are the latest developments in AI agents and autonomous systems in 2025?",
        help="The research query or topic (default: AI agents overview)"
    )

    args = parser.parse_args()

    # Initialize client
    client = create_client()

    # Run research
    result = run_research(client, args.query)

    if result:
        print("\n" + "=" * 50)
        print("RESEARCH RESULTS")
        print("=" * 50 + "\n")
        print(result)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
