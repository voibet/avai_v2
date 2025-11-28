// Prebuilt filter configurations for common trading strategies

export const VALUE_FILTER = {
  "or": [
    {
      "field": {
        "op": "divide",
        "left": "bookmakers.Veikkaus.x12",
        "right": "bookmakers.Pinnacle.fair_x12"
      },
      "op": "gt",
      "value": 1.03
    },
    {
      "field": {
        "op": "divide",
        "left": "bookmakers.Veikkaus.ah",
        "right": "bookmakers.Pinnacle.fair_ah"
      },
      "op": "gt",
      "value": 1.03
    },
    {
      "field": {
        "op": "divide",
        "left": "bookmakers.Veikkaus.ou",
        "right": "bookmakers.Pinnacle.fair_ou"
      },
      "op": "gt",
      "value": 1.03
    }
  ]
}

export const ARBITRAGE_FILTER = {
  "or": [
    {
      "and": [
        {
          "function": "max",
          "source": ["bookmakers.Veikkaus.x12_h", "bookmakers.Pinnacle.x12_h", "bookmakers.Monaco.x12_h", "bookmakers.Betfair.x12_h"],
          "as": "max_h"
        },
        {
          "function": "max",
          "source": ["bookmakers.Veikkaus.x12_x", "bookmakers.Pinnacle.x12_x", "bookmakers.Monaco.x12_x", "bookmakers.Betfair.x12_x"],
          "as": "max_x"
        },
        {
          "function": "max",
          "source": ["bookmakers.Veikkaus.x12_a", "bookmakers.Pinnacle.x12_a", "bookmakers.Monaco.x12_a", "bookmakers.Betfair.x12_a"],
          "as": "max_a"
        },
        {
          "field": {
            "op": "add",
            "left": {
              "op": "add",
              "left": { "op": "divide", "left": 1000000, "right": "$max_h" },
              "right": { "op": "divide", "left": 1000000, "right": "$max_x" }
            },
            "right": { "op": "divide", "left": 1000000, "right": "$max_a" }
          },
          "op": "lt",
          "value": 1000
        }
      ]
    },
    {
      "and": [
        {
          "function": "max_per_line",
          "source": ["bookmakers.Veikkaus.ah_h", "bookmakers.Pinnacle.ah_h", "bookmakers.Monaco.ah_h", "bookmakers.Betfair.ah_h"],
          "as": "max_ah_h"
        },
        {
          "function": "max_per_line",
          "source": ["bookmakers.Veikkaus.ah_a", "bookmakers.Pinnacle.ah_a", "bookmakers.Monaco.ah_a", "bookmakers.Betfair.ah_a"],
          "as": "max_ah_a"
        },
        {
          "field": {
            "op": "add",
            "left": { "op": "divide", "left": 1000000, "right": "$max_ah_h" },
            "right": { "op": "divide", "left": 1000000, "right": "$max_ah_a" }
          },
          "op": "lt",
          "value": 1000
        }
      ]
    },
    {
      "and": [
        {
          "function": "max_per_line",
          "source": ["bookmakers.Veikkaus.ou_o", "bookmakers.Pinnacle.ou_o", "bookmakers.Monaco.ou_o", "bookmakers.Betfair.ou_o"],
          "as": "max_ou_o"
        },
        {
          "function": "max_per_line",
          "source": ["bookmakers.Veikkaus.ou_u", "bookmakers.Pinnacle.ou_u", "bookmakers.Monaco.ou_u", "bookmakers.Betfair.ou_u"],
          "as": "max_ou_u"
        },
        {
          "field": {
            "op": "add",
            "left": { "op": "divide", "left": 1000000, "right": "$max_ou_o" },
            "right": { "op": "divide", "left": 1000000, "right": "$max_ou_u" }
          },
          "op": "lt",
          "value": 1000
        }
      ]
    }
  ]
}

// Helper function to get formatted JSON string for filter input
export const getFilterJson = (filter: any): string => {
  return JSON.stringify(filter, null, 2)
}
