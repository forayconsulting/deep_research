#!/usr/bin/env python3
"""
Gemini Deep Research API Test Script

Uses the Interactions API to run autonomous research tasks with Gemini.
"""

import argparse
import os
import sys
import time

import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Constants
API_BASE = "https://generativelanguage.googleapis.com/v1beta"
AGENT_MODEL = "deep-research-pro-preview-12-2025"
POLL_INTERVAL = 10  # seconds


def get_api_key():
    """Get API key from environment."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY not found in environment variables.")
        print("Please set it in your .env file.")
        sys.exit(1)
    return api_key


def create_interaction(api_key: str, query: str) -> dict:
    """Create a new deep research interaction."""
    url = f"{API_BASE}/interactions"
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key
    }
    payload = {
        "input": query,
        "agent": AGENT_MODEL,
        "background": True
    }

    response = requests.post(url, headers=headers, json=payload)
    response.raise_for_status()
    return response.json()


def get_interaction(api_key: str, interaction_id: str) -> dict:
    """Get the status of an interaction."""
    url = f"{API_BASE}/interactions/{interaction_id}"
    headers = {"x-goog-api-key": api_key}

    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json()


def run_research(api_key: str, query: str):
    """
    Start a deep research task and poll until completion.

    Args:
        api_key: The Gemini API key
        query: The research query/topic

    Returns:
        The research output text
    """
    print(f"\nStarting deep research on: {query}")
    print("-" * 50)

    # Start the research task
    try:
        interaction = create_interaction(api_key, query)
    except requests.exceptions.HTTPError as e:
        print(f"Error creating interaction: {e}")
        print(f"Response: {e.response.text}")
        return None

    interaction_id = interaction.get("name", "").split("/")[-1] or interaction.get("id")
    print(f"Research task started. ID: {interaction_id}")
    print("Polling for results (this may take several minutes)...\n")

    # Poll for completion
    start_time = time.time()
    while True:
        try:
            interaction = get_interaction(api_key, interaction_id)
        except requests.exceptions.HTTPError as e:
            print(f"Error polling: {e}")
            return None

        elapsed = int(time.time() - start_time)
        status = interaction.get("status", "unknown")

        if status == "COMPLETED" or status == "completed":
            print(f"\nResearch completed in {elapsed} seconds!")
            # Extract output text
            outputs = interaction.get("outputs", [])
            if outputs:
                return outputs[-1].get("text", str(outputs[-1]))
            return str(interaction)

        elif status == "FAILED" or status == "failed":
            error = interaction.get("error", "Unknown error")
            print(f"\nResearch failed after {elapsed} seconds: {error}")
            return None

        else:
            print(f"  Status: {status} ({elapsed}s elapsed)")
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

    # Get API key
    api_key = get_api_key()

    # Run research
    result = run_research(api_key, args.query)

    if result:
        print("\n" + "=" * 50)
        print("RESEARCH RESULTS")
        print("=" * 50 + "\n")
        print(result)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
