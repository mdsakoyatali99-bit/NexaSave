(() => {
  const $ = (s) => document.querySelector(s);
  const locationLabel = $("#weatherLocation");
  const weatherDesc = $("#weatherDescription");
  const cacheKey = "nexasave-weather-location-v1";
  const weatherCodes = {
    0:["Clear sky","☀️","sunny"],1:["Mainly clear","🌤️","sunny"],2:["Partly cloudy","⛅","cloudy"],3:["Overcast","☁️","cloudy"],
    45:["Fog","🌫️","fog"],48:["Rime fog","🌫️","fog"],
    51:["Light drizzle","🌦️","rain"],53:["Drizzle","🌦️","rain"],55:["Dense drizzle","🌧️","rain"],
    56:["Freezing drizzle","🌧️","rain"],57:["Dense freezing drizzle","🌧️","rain"],
    61:["Slight rain","🌦️","rain"],63:["Moderate rain","🌧️","rain"],65:["Heavy rain","🌧️","rain"],
    66:["Freezing rain","🌧️","rain"],67:["Heavy freezing rain","🌧️","rain"],
    71:["Slight snow","🌨️","snow"],73:["Moderate snow","❄️","snow"],75:["Heavy snow","❄️","snow"],77:["Snow grains","🌨️","snow"],
    80:["Rain showers","🌦️","rain"],81:["Moderate rain showers","🌧️","rain"],82:["Violent rain showers","⛈️","thunder"],
    85:["Snow showers","🌨️","snow"],86:["Heavy snow showers","❄️","snow"],
    95:["Thunderstorm","⛈️","thunder"],96:["Thunderstorm with hail","⛈️","thunder"],99:["Thunderstorm with heavy hail","⛈️","thunder"]
  };

  function showError(message) {
    locationLabel.textContent = "Weather unavailable";
    weatherDesc.textContent = message;
    weatherDesc.classList.add("weather-error");
    $("#weatherUpdated").textContent = "Try refreshing or search for a city";
  }
  function setTheme(condition, isDay) {
    document.body.classList.remove("weather-sunny","weather-cloudy","weather-rain","weather-thunder","weather-snow","weather-fog","weather-night");
    document.body.classList.add(!isDay ? "weather-night" : `weather-${condition}`);
  }
  function displayWeather(place, data) {
    const c = data.current;
    const [description, icon, theme] = weatherCodes[c.weather_code] || ["Current conditions","🌤️","cloudy"];
    locationLabel.textContent = place;
    $("#weatherIcon").textContent = icon;
    $("#weatherTemp").textContent = `${Math.round(c.temperature_2m)}°`;
    $("#feelsLike").textContent = `${Math.round(c.apparent_temperature)}°`;
    $("#humidity").textContent = `${Math.round(c.relative_humidity_2m)}%`;
    $("#wind").textContent = `${Math.round(c.wind_speed_10m)} km/h`;
    $("#rain").textContent = `${Number(c.precipitation || 0).toFixed(1)} mm`;
    weatherDesc.textContent = description;
    weatherDesc.classList.remove("weather-error");
    setTheme(theme, c.is_day === 1);
    const updated = new Date(c.time);
    $("#weatherUpdated").textContent = `Local conditions · ${updated.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} · Open-Meteo`;
  }
  async function getWeather(lat, lon, place) {
    locationLabel.textContent = place || "Loading local weather…";
    weatherDesc.textContent = "Fetching current local conditions";
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: lat, longitude: lon,
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
      timezone: "auto", forecast_days: "1"
    });
    const response = await fetch(url);
    if (!response.ok) throw new Error("Weather service could not respond.");
    const data = await response.json();
    displayWeather(place || "Your area", data);
    try { localStorage.setItem(cacheKey, JSON.stringify({lat,lon,place})); } catch {}
  }
  async function reverseName(lat, lon) {
    try {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/reverse");
      url.search = new URLSearchParams({latitude:lat,longitude:lon,language:"en",format:"json"});
      const r = await fetch(url);
      const d = await r.json();
      const x = d.results && d.results[0];
      return x ? [x.name,x.admin1,x.country].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(", ") : "Your current location";
    } catch { return "Your current location"; }
  }
  function locate() {
    if (!navigator.geolocation) return showError("This browser does not support location. Search for a city instead.");
    locationLabel.textContent = "Requesting location permission…";
    weatherDesc.textContent = "Your location is used only to request nearby weather.";
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const {latitude,longitude} = pos.coords;
        const place = await reverseName(latitude,longitude);
        await getWeather(latitude,longitude,place);
      } catch { showError("Could not load weather data. Please try again."); }
    }, () => showError("Location permission was denied. Use “Change location” to search for a city."), {
      enableHighAccuracy:false, timeout:12000, maximumAge:600000
    });
  }
  async function searchCity(name) {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({name,count:5,language:"en",format:"json"});
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not search for that place.");
    const data = await response.json();
    return data.results || [];
  }
  $("#changeLocation").addEventListener("click", () => {
    $("#locationForm").classList.remove("hidden");
    $("#locationSearch").focus();
  });
  $("#cancelLocation").addEventListener("click", () => {
    $("#locationForm").classList.add("hidden");
    $("#locationResults").classList.add("hidden");
  });
  $("#locationForm").addEventListener("submit", async event => {
    event.preventDefault();
    const query = $("#locationSearch").value.trim();
    if (!query) return;
    const results = $("#locationResults");
    results.classList.remove("hidden");
    results.textContent = "Searching…";
    try {
      const places = await searchCity(query);
      results.replaceChildren();
      if (!places.length) { results.textContent = "No matching locations found."; return; }
      places.forEach(place => {
        const button = document.createElement("button");
        button.textContent = [place.name,place.admin1,place.country].filter(Boolean).join(", ");
        button.addEventListener("click", async () => {
          try {
            await getWeather(place.latitude,place.longitude,button.textContent);
            $("#locationForm").classList.add("hidden");
            results.classList.add("hidden");
          } catch { showError("Could not load weather for this location."); }
        });
        results.append(button);
      });
    } catch { results.textContent = "Location search failed. Please try again."; }
  });
  $("#refreshWeather").addEventListener("click", () => {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch {}
    if (saved) getWeather(saved.lat,saved.lon,saved.place).catch(() => locate());
    else locate();
  });

  // Use the last visitor-selected location first; otherwise ask for permission.
  let saved;
  try { saved = JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch {}
  if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) {
    getWeather(saved.lat,saved.lon,saved.place).catch(() => locate());
  } else {
    locate();
  }
})();
