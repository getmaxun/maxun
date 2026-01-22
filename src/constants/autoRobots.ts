export const AUTO_ROBOTS = [
  {
    id: "mock-robot-1",
    name: "Extract stories from Medium user profile",
    description: "Scraping Medium profiles for stories, reveals what content truly connects with readers. Example: https://thedankoe.medium.com",
    category: "News",
    logo: "https://img.logo.dev/medium.com?token=live_6a1a28fd-6420-4492-aeb0-b297461d9de2&size=100&retina=true",
    access: "free",
    sample: [
      {
        "Likes": "277",
        "Comments": "6",
        "Story Date": "Aug 26",
        "Story Title": "HUMAN 3.0 — A Map To Reach The Top 1%",
        "Story Description": "Read online free here."
      },
      {
        "Likes": "351",
        "Comments": "6",
        "Story Date": "Jul 31",
        "Story Title": "You don't need a niche, you need a point of view",
        "Story Description": "How to survive in the AI generated internet"
      },
      {
        "Likes": "412",
        "Comments": "11",
        "Story Date": "Jul 22",
        "Story Title": "You have about 36 months to make it",
        "Story Description": "why everyone is racing to get rich"
      }
    ]
  },
  {
    id: "mock-robot-2",
    name: "Extract Apps From Pipedream",
    description: "Browse available Pipedream apps to tap into automation tools.",
    category: "Tech",
    logo: "https://img.logo.dev/pipedream.com?token=live_6a1a28fd-6420-4492-aeb0-b297461d9de2&size=100&retina=true",
    access: "free",
    sample: [
      {
        "App": "HTTP / Webhook",
        "Description": "Get a unique URL where you can send HTTP or webhook requests"
      },
      {
        "App": "Node",
        "Description": "Anything you can do with Node.js, you can do in a Pipedream workflow. This includes using most of npm's 400,000+ packages."
      },
      {
        "App": "Python",
        "Description": "Anything you can do in Python can be done in a Pipedream Workflow. This includes using any of the 350,000+ PyPi packages."
      }
    ]
  },
  {
    id: "mock-robot-3",
    name: "Extract URLs from Sitemap URL Set",
    description: "Extract URLs from XML sitemaps—special .xml files that websites publish to list all their public pages and update frequencies. Example: https://www.nike.com/sitemap-us-help.xml",
    category: "Tech",
    logo: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSDdTRSGj8VljQR4AOE2QewgUJvqxDkxI7GkW5CnwMxuwdgwHCpiV1whxI&s=10",
    access: "free",
    sample: [
      {
        "loc": "https://www.nike.com/help/a/promo-code-terms",
        "lastmod": "2019-02-06"
      },
      {
        "loc": "https://www.nike.com/help/a/nfl-jersey",
        "lastmod": "2019-02-06"
      },
      {
        "loc": "https://www.nike.com/help/a/free-shipping",
        "lastmod": "2019-02-06"
      }
    ],
    configOptions: {
      parameters: [
        {
          id: "website_url",
          type: "url" as const,
          label: "Website URL",
          required: true,
          queryParam: "url",
          placeholder: "https://www.nike.com/sitemap-us-help.xml"
        },
        {
          id: "result_limit",
          type: "limit" as const,
          label: "Number of entries",
          required: true,
          queryParam: "limit",
          placeholder: "100"
        }
      ]
    }
  },
  {
    id: "mock-robot-4",
    name: "Extract trending repositories from Github",
    description: "Spot trending GitHub repos to follow what developers are building.",
    category: "Tech",
    logo: "https://img.logo.dev/github.com?token=live_6a1a28fd-6420-4492-aeb0-b297461d9de2&size=100&retina=true",
    access: "free",
    sample: [
      {
        "URL": "https://github.com/microsoft/markitdown",
        "Name": "microsoft / markitdown",
        "Forks": "2,608",
        "Stars": "52,816",
        "Language": "Python",
        "Description": "Python tool for converting files and office documents to Markdown.",
        "Stars Today": "822 stars today"
      },
      {
        "URL": "https://github.com/hydralauncher/hydra",
        "Name": "hydralauncher / hydra",
        "Forks": "3,533",
        "Stars": "12,547",
        "Language": "TypeScript",
        "Description": "Hydra is a game launcher with its own embedded bittorrent client",
        "Stars Today": "112 stars today"
      },
      {
        "URL": "https://github.com/pocketbase/pocketbase",
        "Name": "pocketbase / pocketbase",
        "Forks": "2,257",
        "Stars": "45,993",
        "Language": "Go",
        "Description": "Open Source realtime backend in 1 file",
        "Stars Today": "391 stars today"
      }
    ]
  },
  {
    id: "mock-robot-5",
    name: "Extract companies from trustpilot search results",
    description: "Search for any information regarding companies and extract data received from the search results. Example: https://www.trustpilot.com/search?query=Car%20wash%20near%20me",
    category: "Companies",
    logo: "https://img.logo.dev/trustpilot.com?token=live_6a1a28fd-6420-4492-aeb0-b297461d9de2&size=100&retina=true",
    access: "free",
    sample: [
      {
        "Name": "IMO Car Wash",
        "Site": "www.imocarwash.com",
        "Rating": "2.5",
        "Address": "35 - 37 Amersham Hill, High Wycombe, United Kingdom",
        "Total Reviews": "2,894"
      },
      {
        "Name": "Tint World",
        "Site": "www.tintworld.com",
        "Rating": "3.5",
        "Address": "United States",
        "Total Reviews": "820"
      },
      {
        "Name": "Shinearmor",
        "Site": "shinearmor.com",
        "Rating": "4.2",
        "Address": "Philips Hwy 6100, Jacksonville, United States",
        "Total Reviews": "311"
      }
    ],
    configOptions: {
      parameters: [
        {
          id: "search_query",
          type: "search" as const,
          label: "Search Query",
          required: true,
          queryParam: "query",
          placeholder: "Enter business type or name (e.g., Car dealer near me, Pizza restaurant NYC, etc.)"
        }
      ]
    }
  },
  {
    id: "mock-robot-6",
    name: "Extract extension reviews from Chrome Web Store",
    description: "Gather Chrome extension reviews and ratings to analyze user feedback and popularity trends.",
    category: "Tech",
    logo: "https://img.logo.dev/chromewebstore.google.com?token=live_6a1a28fd-6420-4492-aeb0-b297461d9de2&size=100&retina=true",
    access: "free",
    sample: [
      {
        "Date": "Jul 9, 2025",
        "Review": "Very useful and easy to use tool. Highly recommended!",
        "Reviewer Name": "Jean-Philippe Demoulin"
      },
      {
        "Date": "Jul 8, 2025",
        "Review": "Been using this tool for some time now and the new update is a game changer!",
        "Reviewer Name": "Michael Libman"
      },
      {
        "Date": "Jul 8, 2025",
        "Review": "It's a great tool and the customer service is the best!",
        "Reviewer Name": "Telma V"
      }
    ],
    configOptions: {
      parameters: [
        {
          id: "website_url",
          type: "url" as const,
          label: "Extension reviews URL",
          required: true,
          queryParam: "url",
          placeholder: "https://chromewebstore.google.com/detail/extension-id/reviews"
        }
      ]
    }
  },
  {
    id: "mock-robot-7",
    name: "Extract Newest Products From FutureTools.io Based On Category",
    description: "Explore the latest tools from FutureTools.io by category. Example: https://www.futuretools.io/?search=youtube",
    category: "Tech",
    logo: "https://img.logo.dev/futuretools.io?token=live_6a1a28fd-6420-4492-aeb0-b297461d9de2&size=100&retina=true",
    access: "free",
    sample: [
      {
        "URL": "https://www.futuretools.io/tools/virlo",
        "Name": "Virlo",
        "Upvotes": "7",
        "Category": "Social Media",
        "Description": "A platform to analyze trends and insights to optimize short-form content for viral potential on social media."
      },
      {
        "URL": "https://www.futuretools.io/tools/noteey",
        "Name": "Noteey",
        "Upvotes": "3",
        "Category": "Productivity",
        "Description": "A tool to organize, annotate, and connect visual notes offline."
      },
      {
        "URL": "https://www.futuretools.io/tools/papira",
        "Name": "Papira",
        "Upvotes": "2",
        "Category": "Copywriting",
        "Description": "A tool to create documents using personalized AI writing commands."
      }
    ],
    configOptions: {
      parameters: [
        {
          id: "search_query",
          type: "search" as const,
          label: "Search Query",
          required: true,
          queryParam: "search",
          placeholder: "Enter tool category (e.g., youtube, music etc.)"
        }
      ]
    }
  },
  {
    id: "mock-robot-8",
    name: "Extract Google Trends based on region",
    description: "Extracting Google Trends by region uncovers what topics are gaining traction in specific areas.",
    category: "News",
    logo: "https://img.logo.dev/google.com?token=live_6a1a28fd-6420-4492-aeb0-b297461d9de2&size=100&retina=true",
    access: "free",
    sample: [
      {
        "Rise": "1,000%",
        "Trend": "AI developments",
        "Started": "23 hours ago",
        "Search Volume": "500K+"
      },
      {
        "Rise": "1,000%",
        "Trend": "Tech innovations",
        "Started": "19 hours ago",
        "Search Volume": "100K+"
      },
      {
        "Rise": "1,000%",
        "Trend": "Market trends",
        "Started": "24 hours ago",
        "Search Volume": "500K+"
      }
    ],
    configOptions: {
      parameters: [
        {
          id: "geo",
          type: "dropdown" as const,
          label: "Region",
          options: [
            { label: "India", value: "IN" },
            { label: "United States", value: "US" },
            { label: "United Kingdom", value: "GB" },
            { label: "Canada", value: "CA" },
            { label: "Australia", value: "AU" },
            { label: "Germany", value: "DE" },
            { label: "France", value: "FR" },
            { label: "Japan", value: "JP" },
            { label: "Brazil", value: "BR" },
            { label: "Mexico", value: "MX" }
          ],
          required: true,
          queryParam: "geo"
        }
      ]
    }
  },
  {
    id: "mock-robot-9",
    name: "Extract HTML code and full screenshot from a webpage",
    description: "Extract HTML source code with matching visual screenshots.",
    category: "Tech",
    logo: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSDdTRSGj8VljQR4AOE2QewgUJvqxDkxI7GkW5CnwMxuwdgwHCpiV1whxI&s=10",
    access: "free",
    sample: [
      {
        "Label": "html",
        "Value": "<html lang=\"en\"><head><title>Example Page</title>..."
      }
    ],
    configOptions: {
      parameters: [
        {
          id: "website_url",
          type: "url" as const,
          label: "Website URL",
          required: true,
          queryParam: "url",
          placeholder: "https://www.example.com"
        }
      ]
    }
  },
  {
    id: "mock-robot-10",
    name: "Extract jobs from Craigslist based on location and industry",
    description: "Get job listings from Craigslist filtered by region and sector.",
    category: "Jobs",
    logo: "https://img.logo.dev/craigslist.com?token=live_6a1a28fd-6420-4492-aeb0-b297461d9de2&size=100&retina=true",
    access: "free",
    sample: [
      {
        "Job": "Nurses Should Apply",
        "Location": "Sacramento",
        "Date Posted": "22/04",
        "Description": "Commission & Bonuses Only"
      },
      {
        "Job": "Entry Level Full-Time Bookkeeper Needed",
        "Location": "Arden Area",
        "Date Posted": "19/04",
        "Description": "Pay Depending on Experience"
      },
      {
        "Job": "Entry Level Full-Time Bookkeeper Needed",
        "Location": "Arden Area",
        "Date Posted": "15/04",
        "Description": "Pay Depending on Experience"
      }
    ]
  },
  {
    id: "mock-robot-11",
    name: "Extract popular movies by genre from IMDb",
    description: "Find trending IMDb movies sorted by genre for entertainment insights.",
    category: "Entertainment",
    logo: "https://img.logo.dev/imdb.com?token=live_6a1a28fd-6420-4492-aeb0-b297461d9de2&size=100&retina=true",
    access: "free",
    sample: [
      {
        "Year": "2025",
        "Title": "Frankenstein",
        "Votes": "(76K)",
        "Rating": "7.6",
        "Duration": "2h 29m",
        "Description": "A brilliant but egotistical scientist brings a creature to life in a monstrous experiment."
      },
      {
        "Year": "2025",
        "Title": "Weapons",
        "Votes": "(236K)",
        "Rating": "7.5",
        "Duration": "2h 8m",
        "Description": "A community questions who is behind mysterious disappearances."
      },
      {
        "Year": "2025",
        "Title": "The Black Phone 2",
        "Votes": "(28K)",
        "Rating": "6.3",
        "Duration": "1h 54m",
        "Description": "A teen struggles with life after captivity while his sister receives disturbing calls."
      }
    ],
    configOptions: {
      parameters: [
        {
          id: "title_type",
          type: "dropdown" as const,
          label: "Movie Type",
          options: [
            { label: "Movie", value: "feature" },
            { label: "TV Series", value: "tv_series" },
            { label: "Short", value: "short" },
            { label: "Documentary", value: "documentary" }
          ],
          required: true,
          queryParam: "title_type"
        },
        {
          id: "genres",
          type: "dropdown" as const,
          label: "Genre",
          options: [
            { label: "Action", value: "action" },
            { label: "Comedy", value: "comedy" },
            { label: "Drama", value: "drama" },
            { label: "Horror", value: "horror" },
            { label: "Thriller", value: "thriller" },
            { label: "Sci-Fi", value: "sci_fi" }
          ],
          required: true,
          queryParam: "genres"
        }
      ]
    }
  },
  {
    id: "mock-robot-12",
    name: "Extract complete text and full screenshot from a webpage",
    description: "Capture webpage text content alongside visual screenshots in one go.",
    category: "Tech",
    logo: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSDdTRSGj8VljQR4AOE2QewgUJvqxDkxI7GkW5CnwMxuwdgwHCpiV1whxI&s=10",
    access: "free",
    sample: [
      {
        "Label": "text",
        "Value": "Welcome to the website! Discover new products and services..."
      }
    ],
    configOptions: {
      parameters: [
        {
          id: "website_url",
          type: "url" as const,
          label: "Website URL",
          required: true,
          queryParam: "url",
          placeholder: "https://www.example.com"
        }
      ]
    }
  },
  {
    id: "mock-robot-13",
    name: "Extract YCombinator Companies",
    description: "Pull data on startups backed by Y Combinator to track innovation.",
    category: "Tech",
    logo: "https://img.logo.dev/ycombinator.com?token=live_6a1a28fd-6420-4492-aeb0-b297461d9de2&size=100&retina=true",
    access: "free",
    sample: [
      {
        "Name": "Airbnb",
        "Location": "San Francisco, CA, USA",
        "YC Season": "W09",
        "Category": "CONSUMER",
        "Description": "Book accommodations around the world."
      },
      {
        "Name": "Amplitude",
        "Location": "San Francisco, CA, USA",
        "YC Season": "W12",
        "Category": "B2B",
        "Description": "Digital Analytics Platform"
      },
      {
        "Name": "Coinbase",
        "Location": "San Francisco, CA, USA",
        "YC Season": "S12",
        "Category": "FINTECH",
        "Description": "Buy, sell, and manage cryptocurrencies."
      }
    ]
  },
  {
    id: "mock-robot-14",
    name: "Extract products from Product Hunt based on category",
    description: "Discover top Product Hunt launches tailored to specific categories.",
    category: "Tech",
    logo: "https://img.logo.dev/producthunt.com?token=live_6a1a28fd-6420-4492-aeb0-b297461d9de2&size=100&retina=true",
    access: "free",
    sample: [
      {
        "Name": "OpenAI",
        "Description": "The most powerful platform for building AI products.",
        "Reviews": "4.6 (78 reviews)"
      },
      {
        "Name": "Claude by Anthropic",
        "Description": "AI research company building reliable AI systems.",
        "Reviews": "4.8 (117 reviews)"
      },
      {
        "Name": "ChatGPT by OpenAI",
        "Description": "Get instant answers and creative inspiration.",
        "Reviews": "4.7 (768 reviews)"
      }
    ],
    configOptions: {
      parameters: [
        {
          id: "category",
          type: "path-segment" as const,
          label: "Category",
          required: true,
          queryParam: "category",
          placeholder: "e.g., health-fitness"
        }
      ]
    }
  }
];
