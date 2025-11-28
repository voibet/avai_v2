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

export const DEFAULT_VALUE_FILTER = {
  "or": [
    {
      "field": {
        "op": "divide",
        "left": "bookmakers.Veikkaus.x12",
        "right": {
          "op": "divide",
          "left": { "op": "add", "left": "bookmakers.Pinnacle.fair_x12", "right": "bookmakers.Betfair.fair_x12" },
          "right": 2
        }
      },
      "op": "gt",
      "value": 1.03
    },
    {
      "and": [
        {
          "function": "avg_per_line",
          "source": ["bookmakers.Pinnacle.fair_ah_h", "bookmakers.Betfair.fair_ah_h"],
          "as": "avg_fair_ah_h"
        },
        {
          "function": "avg_per_line",
          "source": ["bookmakers.Pinnacle.fair_ah_a", "bookmakers.Betfair.fair_ah_a"],
          "as": "avg_fair_ah_a"
        },
        {
          "or": [
            {
              "field": { "op": "divide", "left": "bookmakers.Veikkaus.ah_h", "right": "$avg_fair_ah_h" },
              "op": "gt", "value": 1.03
            },
            {
              "field": { "op": "divide", "left": "bookmakers.Veikkaus.ah_a", "right": "$avg_fair_ah_a" },
              "op": "gt", "value": 1.03
            }
          ]
        }
      ]
    },
    {
      "and": [
        {
          "function": "avg_per_line",
          "source": ["bookmakers.Pinnacle.fair_ou_o", "bookmakers.Betfair.fair_ou_o"],
          "as": "avg_fair_ou_o"
        },
        {
          "function": "avg_per_line",
          "source": ["bookmakers.Pinnacle.fair_ou_u", "bookmakers.Betfair.fair_ou_u"],
          "as": "avg_fair_ou_u"
        },
        {
          "or": [
            {
              "field": { "op": "divide", "left": "bookmakers.Veikkaus.ou_o", "right": "$avg_fair_ou_o" },
              "op": "gt", "value": 1.03
            },
            {
              "field": { "op": "divide", "left": "bookmakers.Veikkaus.ou_u", "right": "$avg_fair_ou_u" },
              "op": "gt", "value": 1.03
            }
          ]
        }
      ]
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

export const PINNACLE_DROP = {
  "or": [
    {
      "field": {
        "op": "divide",
        "left": { "op": "history", "left": "bookmakers.Pinnacle.x12", "right": 300000 },
        "right": "bookmakers.Pinnacle.x12"
      },
      "op": "gt",
      "value": 1.05
    },
    {
      "field": {
        "op": "divide",
        "left": { "op": "history", "left": "bookmakers.Pinnacle.ah", "right": 300000 },
        "right": "bookmakers.Pinnacle.ah"
      },
      "op": "gt",
      "value": 1.05
    },
    {
      "field": {
        "op": "divide",
        "left": { "op": "history", "left": "bookmakers.Pinnacle.ou", "right": 300000 },
        "right": "bookmakers.Pinnacle.ou"
      },
      "op": "gt",
      "value": 1.05
    }
  ]
}

// Helper function to get formatted JSON string for filter input
export const getFilterJson = (filter: any): string => {
  return JSON.stringify(filter, null, 2)
}
