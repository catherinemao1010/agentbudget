"""Run explicitly after setting OPENAI_API_KEY. This makes a paid model request."""
from agentbudget import BudgetClient

if __name__ == "__main__":
    client = BudgetClient()
    try:
        with client.task("Explain context managers", limit_usd=0.05, agent="Documentation agent") as task:
            response = task.response("Explain Python context managers in three sentences.", max_output_tokens=256)
            print(response["output"])
    finally:
        client.close()
