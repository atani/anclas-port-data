import type { MatchForecast } from "./types.js";

/**
 * Open-Meteo（無料・キー不要）から指定地点・指定時刻の予報を取得する。
 * 予報は 16 日先まで取得できるため、キックオフ 14 日前からの表示に使う。
 * https://open-meteo.com/en/docs
 */
export async function fetchForecast(
  latitude: number,
  longitude: number,
  kickoffIso: string,
): Promise<MatchForecast | null> {
  const date = kickoffIso.slice(0, 10);
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${latitude}&longitude=${longitude}` +
    "&hourly=temperature_2m,precipitation_probability,weather_code" +
    "&timezone=Asia%2FTokyo" +
    `&start_date=${date}&end_date=${date}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const body = (await res.json()) as {
    hourly?: {
      time: string[];
      temperature_2m: (number | null)[];
      precipitation_probability: (number | null)[];
      weather_code: (number | null)[];
    };
  };
  const hourly = body.hourly;
  if (!hourly || hourly.time.length === 0) return null;

  const index = pickNearestHourIndex(hourly.time, kickoffIso);
  const temperature = hourly.temperature_2m[index];
  const weatherCode = hourly.weather_code[index];
  if (temperature == null || weatherCode == null) return null;

  return {
    temperatureC: temperature,
    precipitationProbability: hourly.precipitation_probability[index] ?? null,
    weatherCode,
    fetchedAt: new Date().toISOString(),
  };
}

/** hourly.time（"YYYY-MM-DDTHH:mm" JST）から目標時刻に最も近いインデックスを返す */
export function pickNearestHourIndex(times: string[], targetIso: string): number {
  const target = new Date(targetIso).getTime();
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    // Open-Meteo の time はタイムゾーン指定なし（リクエストした timezone=JST のローカル時刻）
    const t = new Date(`${times[i]}+09:00`).getTime();
    const diff = Math.abs(t - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}
