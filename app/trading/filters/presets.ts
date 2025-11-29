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
      "and": [
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
          "value": 1.02
        },
        {
          "or": [
            {
              "field": {
                "op": "divide",
                "left": { "op": "history", "left": "bookmakers.Pinnacle.fair_x12", "right": 60000 },
                "right": "bookmakers.Pinnacle.fair_x12"
              },
              "op": "gt",
              "value": 1.01
            },
            {
              "field": {
                "op": "divide",
                "left": { "op": "history", "left": "bookmakers.Betfair.fair_x12", "right": 60000 },
                "right": "bookmakers.Betfair.fair_x12"
              },
              "op": "gt",
              "value": 1.01
            }
          ]
        },
        {
          "function": "max",
          "source": ["bookmakers.Veikkaus.x12_h", "bookmakers.Pinnacle.x12_h", "bookmakers.Monaco.x12_h", "bookmakers.Betfair.x12_h"],
          "as": "max_x12_h"
        },
        {
          "function": "max",
          "source": ["bookmakers.Veikkaus.x12_x", "bookmakers.Pinnacle.x12_x", "bookmakers.Monaco.x12_x", "bookmakers.Betfair.x12_x"],
          "as": "max_x12_x"
        },
        {
          "function": "max",
          "source": ["bookmakers.Veikkaus.x12_a", "bookmakers.Pinnacle.x12_a", "bookmakers.Monaco.x12_a", "bookmakers.Betfair.x12_a"],
          "as": "max_x12_a"
        },
        {
          "field": {
            "op": "add",
            "left": {
              "op": "add",
              "left": { "op": "divide", "left": 1000000, "right": "$max_x12_h" },
              "right": { "op": "divide", "left": 1000000, "right": "$max_x12_x" }
            },
            "right": { "op": "divide", "left": 1000000, "right": "$max_x12_a" }
          },
          "op": "lt",
          "value": 1010
        }
      ]
    },
    {
      "or": [
        {
          "and": [
            {
              "function": "avg_per_line",
              "source": ["bookmakers.Pinnacle.fair_ah_h", "bookmakers.Betfair.fair_ah_h"],
              "as": "avg_fair_ah_h"
            },
            {
              "or": [
                {
                  "field": {
                    "op": "divide",
                    "left": { "op": "history", "left": "bookmakers.Pinnacle.fair_ah_h", "right": 60000 },
                    "right": "bookmakers.Pinnacle.fair_ah_h"
                  },
                  "op": "gt",
                  "value": 1.01
                },
                {
                  "field": {
                    "op": "divide",
                    "left": { "op": "history", "left": "bookmakers.Betfair.fair_ah_h", "right": 60000 },
                    "right": "bookmakers.Betfair.fair_ah_h"
                  },
                  "op": "gt",
                  "value": 1.01
                }
              ]
            },
            {
              "field": { "op": "divide", "left": "bookmakers.Veikkaus.ah_h", "right": "$avg_fair_ah_h" },
              "op": "gt", "value": 1.02
            },
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
              "value": 1010
            }
          ]
        },
        {
          "and": [
            {
              "function": "avg_per_line",
              "source": ["bookmakers.Pinnacle.fair_ah_a", "bookmakers.Betfair.fair_ah_a"],
              "as": "avg_fair_ah_a"
            },
            {
              "or": [
                {
                  "field": {
                    "op": "divide",
                    "left": { "op": "history", "left": "bookmakers.Pinnacle.fair_ah_a", "right": 60000 },
                    "right": "bookmakers.Pinnacle.fair_ah_a"
                  },
                  "op": "gt",
                  "value": 1.01
                },
                {
                  "field": {
                    "op": "divide",
                    "left": { "op": "history", "left": "bookmakers.Betfair.fair_ah_a", "right": 60000 },
                    "right": "bookmakers.Betfair.fair_ah_a"
                  },
                  "op": "gt",
                  "value": 1.01
                }
              ]
            },
            {
              "field": { "op": "divide", "left": "bookmakers.Veikkaus.ah_a", "right": "$avg_fair_ah_a" },
              "op": "gt", "value": 1.02
            },
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
              "value": 1010
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
          "function": "avg_per_line",
          "source": [
            { "op": "history", "left": "bookmakers.Pinnacle.fair_ou_o", "right": 60000 },
            { "op": "history", "left": "bookmakers.Betfair.fair_ou_o", "right": 60000 }
          ],
          "as": "avg_fair_ou_o_hist"
        },
        {
          "function": "avg_per_line",
          "source": [
            { "op": "history", "left": "bookmakers.Pinnacle.fair_ou_u", "right": 60000 },
            { "op": "history", "left": "bookmakers.Betfair.fair_ou_u", "right": 60000 }
          ],
          "as": "avg_fair_ou_u_hist"
        },
        {
          "field": {
            "op": "divide",
            "left": "$avg_fair_ou_o_hist",
            "right": "$avg_fair_ou_o"
          },
          "op": "gt",
          "value": 1.02
        },
        {
          "field": {
            "op": "divide",
            "left": "$avg_fair_ou_u_hist",
            "right": "$avg_fair_ou_u"
          },
          "op": "gt",
          "value": 1.02
        },
        {
          "or": [
            {
              "and": [
                {
                  "field": {
                    "op": "divide",
                    "left": { "op": "history", "left": "bookmakers.Pinnacle.fair_ou_o", "right": 60000 },
                    "right": "bookmakers.Pinnacle.fair_ou_o"
                  },
                  "op": "gt",
                  "value": 1.01
                },
                {
                  "field": {
                    "op": "divide",
                    "left": { "op": "history", "left": "bookmakers.Betfair.fair_ou_o", "right": 60000 },
                    "right": "bookmakers.Betfair.fair_ou_o"
                  },
                  "op": "gt",
                  "value": 1.01
                },
                {
                  "field": { "op": "divide", "left": "bookmakers.Veikkaus.ou_o", "right": "$avg_fair_ou_o" },
                  "op": "gt", "value": 1.02
                },
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
                  "value": 1010
                }
              ]
            },
            {
              "and": [
                {
                  "field": {
                    "op": "divide",
                    "left": { "op": "history", "left": "bookmakers.Pinnacle.fair_ou_u", "right": 60000 },
                    "right": "bookmakers.Pinnacle.fair_ou_u"
                  },
                  "op": "gt",
                  "value": 1.01
                },
                {
                  "field": {
                    "op": "divide",
                    "left": { "op": "history", "left": "bookmakers.Betfair.fair_ou_u", "right": 60000 },
                    "right": "bookmakers.Betfair.fair_ou_u"
                  },
                  "op": "gt",
                  "value": 1.01
                },
                {
                  "field": { "op": "divide", "left": "bookmakers.Veikkaus.ou_u", "right": "$avg_fair_ou_u" },
                  "op": "gt", "value": 1.02
                },
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
                  "value": 1010
                }
              ]
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
    // Asian Handicap Arbitrage
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
    // Over/Under Arbitrage
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
        "left": { "op": "history", "left": "bookmakers.Pinnacle.x12", "right": 60000 },
        "right": "bookmakers.Pinnacle.x12"
      },
      "op": "gt",
      "value": 1.05
    },
    {
      "field": {
        "op": "divide",
        "left": { "op": "history", "left": "bookmakers.Pinnacle.ah", "right": 60000 },
        "right": "bookmakers.Pinnacle.ah"
      },
      "op": "gt",
      "value": 1.05
    },
    {
      "field": {
        "op": "divide",
        "left": { "op": "history", "left": "bookmakers.Pinnacle.ou", "right": 60000 },
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
