
import dotenv from 'dotenv';

dotenv.config();
const apiKey = process.env.USYCSTEM_API_KEY;

export async function getStableFXQuote(
  fromCurrency: string,
  fromAmount: string,
  toCurrency: string
) {
  const response = await fetch("https://api.circle.com/v1/exchange/stablefx/quotes", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { currency: fromCurrency, amount: fromAmount },
      to: { currency: toCurrency },
      tenor: "instant",
    }),
  });

  if (!response.ok) {
    throw new Error(`Circle API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}


getStableFXQuote("USDC", "100", "EURC")
  .then((quote) => {
    console.log("StableFX Quote:", quote);
  })
  .catch((error) => {
    console.error("Error fetching StableFX quote:", error);
  });

  