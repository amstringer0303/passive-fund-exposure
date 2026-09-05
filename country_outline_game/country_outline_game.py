from __future__ import annotations

import argparse
import math
import random
import re
import sys
import tkinter as tk
import unicodedata
from dataclasses import dataclass
from difflib import get_close_matches
from tkinter import ttk

import cartopy.io.shapereader as shpreader
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union


COUNTRY_TYPES = {"Sovereign country", "Sovereignty"}
EXTRA_COUNTRY_ADMINS = {
    "Australia",
    "Denmark",
    "Finland",
    "France",
    "Israel",
    "Netherlands",
    "New Zealand",
    "China",
    "United Kingdom",
    "United States of America",
}
EXCLUDED_ADMINS = {"Somaliland", "Northern Cyprus"}

DISPLAY_NAME_OVERRIDES = {
    "East Timor": "Timor-Leste",
    "Ivory Coast": "Cote d'Ivoire",
}

MANUAL_ALIASES = {
    "america": "United States of America",
    "us": "United States of America",
    "u s": "United States of America",
    "usa": "United States of America",
    "u s a": "United States of America",
    "united states": "United States of America",
    "uk": "United Kingdom",
    "u k": "United Kingdom",
    "britain": "United Kingdom",
    "great britain": "United Kingdom",
    "england": "United Kingdom",
    "china": "China",
    "prc": "China",
    "peoples republic of china": "China",
    "czech republic": "Czechia",
    "czechia": "Czechia",
    "ivory coast": "Cote d'Ivoire",
    "cote divoire": "Cote d'Ivoire",
    "cote d ivoire": "Cote d'Ivoire",
    "timor leste": "Timor-Leste",
    "east timor": "Timor-Leste",
    "drc": "Democratic Republic of the Congo",
    "democratic republic congo": "Democratic Republic of the Congo",
    "congo kinshasa": "Democratic Republic of the Congo",
    "republic congo": "Republic of the Congo",
    "congo brazzaville": "Republic of the Congo",
    "congo": "Republic of the Congo",
    "uae": "United Arab Emirates",
    "emirates": "United Arab Emirates",
    "burma": "Myanmar",
    "swaziland": "Eswatini",
    "cape verde": "Cabo Verde",
    "russia": "Russia",
    "south korea": "South Korea",
    "north korea": "North Korea",
    "micronesia": "Federated States of Micronesia",
    "sao tome": "Sao Tome and Principe",
    "sao tome and principe": "Sao Tome and Principe",
    "st kitts": "Saint Kitts and Nevis",
    "st kitts and nevis": "Saint Kitts and Nevis",
    "st lucia": "Saint Lucia",
    "st vincent": "Saint Vincent and the Grenadines",
    "st vincent and the grenadines": "Saint Vincent and the Grenadines",
}


@dataclass(frozen=True)
class Country:
    name: str
    geometry: BaseGeometry
    lon: float
    lat: float
    aliases: tuple[str, ...]


def normalize_name(value: str) -> str:
    """Normalize typed country names for accent-insensitive matching."""
    text = unicodedata.normalize("NFKD", value)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().strip()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\bthe\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def is_country_record(attrs: dict) -> bool:
    admin = attrs.get("ADMIN") or ""
    country_type = attrs.get("TYPE") or ""
    if admin in EXCLUDED_ADMINS:
        return False
    return country_type in COUNTRY_TYPES or admin in EXTRA_COUNTRY_ADMINS


def display_name(attrs: dict) -> str:
    name = attrs.get("ADMIN") or attrs.get("NAME_LONG") or attrs.get("NAME_EN") or attrs.get("NAME")
    return DISPLAY_NAME_OVERRIDES.get(name, name)


def display_unit_name(attrs: dict) -> str:
    name = attrs.get("GEOUNIT") or attrs.get("NAME_LONG") or attrs.get("NAME_EN") or attrs.get("NAME")
    return DISPLAY_NAME_OVERRIDES.get(name, name)


def load_map_unit_geometries(resolution: str) -> dict[str, BaseGeometry]:
    path = shpreader.natural_earth(
        resolution=resolution,
        category="cultural",
        name="admin_0_map_units",
    )
    geometries: dict[str, BaseGeometry] = {}

    for record in shpreader.Reader(path).records():
        unit_name = display_unit_name(record.attributes)
        if not unit_name:
            continue
        geometries.setdefault(normalize_name(unit_name), record.geometry)

    return geometries


def load_composed_map_unit_geometries(resolution: str) -> dict[str, BaseGeometry]:
    path = shpreader.natural_earth(
        resolution=resolution,
        category="cultural",
        name="admin_0_map_units",
    )
    allowed_types = {"Country", "Geo core", "Geo unit", "Sovereign country"}
    grouped: dict[str, list[BaseGeometry]] = {}

    for record in shpreader.Reader(path).records():
        attrs = record.attributes
        unit_type = attrs.get("TYPE") or ""
        if unit_type not in allowed_types:
            continue

        for key_name in (attrs.get("ADMIN"), attrs.get("SOVEREIGNT")):
            if isinstance(key_name, str) and key_name.strip():
                grouped.setdefault(normalize_name(key_name), []).append(record.geometry)

    return {
        key: unary_union(geometries)
        for key, geometries in grouped.items()
        if geometries
    }


def label_point(attrs: dict, geometry: BaseGeometry) -> tuple[float, float]:
    lon = attrs.get("LABEL_X")
    lat = attrs.get("LABEL_Y")
    if lon is not None and lat is not None:
        return float(lon), float(lat)
    point = geometry.representative_point()
    return float(point.x), float(point.y)


def load_countries(resolution: str = "10m") -> list[Country]:
    path = shpreader.natural_earth(
        resolution=resolution,
        category="cultural",
        name="admin_0_countries",
    )
    map_unit_geometries = load_map_unit_geometries(resolution)
    composed_map_unit_geometries = load_composed_map_unit_geometries(resolution)
    countries: list[Country] = []
    seen: set[str] = set()

    for record in shpreader.Reader(path).records():
        attrs = record.attributes
        if not is_country_record(attrs):
            continue

        name = display_name(attrs)
        if not name or name in seen:
            continue
        seen.add(name)

        aliases = {
            name,
            attrs.get("ADMIN"),
            attrs.get("NAME"),
            attrs.get("NAME_LONG"),
            attrs.get("NAME_EN"),
            attrs.get("FORMAL_EN"),
            attrs.get("SOVEREIGNT"),
            attrs.get("ABBREV"),
        }
        aliases = {a for a in aliases if isinstance(a, str) and a.strip()}
        geometry = (
            map_unit_geometries.get(normalize_name(name))
            or composed_map_unit_geometries.get(normalize_name(name))
            or record.geometry
        )
        lon, lat = label_point(attrs, geometry)
        countries.append(Country(name=name, geometry=geometry, lon=lon, lat=lat, aliases=tuple(sorted(aliases))))

    return sorted(countries, key=lambda c: c.name)


def build_alias_index(countries: list[Country]) -> dict[str, Country]:
    by_name = {country.name: country for country in countries}
    index: dict[str, Country] = {}

    for country in countries:
        for alias in country.aliases:
            index.setdefault(normalize_name(alias), country)

    for alias, target in MANUAL_ALIASES.items():
        if target in by_name:
            index[normalize_name(alias)] = by_name[target]

    return index


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    radius_km = 6371.0088
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius_km * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def iter_polygons(geometry: BaseGeometry):
    if isinstance(geometry, Polygon):
        yield geometry
    elif isinstance(geometry, MultiPolygon):
        yield from geometry.geoms
    elif isinstance(geometry, GeometryCollection):
        for part in geometry.geoms:
            yield from iter_polygons(part)


def unwrap_lon(lon: float, center_lon: float) -> float:
    while lon - center_lon > 180:
        lon -= 360
    while lon - center_lon < -180:
        lon += 360
    return lon


def country_rings(country: Country) -> list[list[tuple[float, float]]]:
    rings: list[list[tuple[float, float]]] = []
    for polygon in iter_polygons(country.geometry):
        raw_rings = [polygon.exterior]
        for ring in raw_rings:
            points = [(unwrap_lon(float(x), country.lon), float(y)) for x, y in ring.coords]
            if len(points) >= 2:
                rings.append(points)
    return rings


def canvas_paths(country: Country, width: int, height: int, margin: int = 52) -> list[list[float]]:
    rings = country_rings(country)
    if not rings:
        return []

    mean_lat = country.lat
    x_scale = max(0.18, math.cos(math.radians(mean_lat)))
    flat_rings = [[(lon * x_scale, lat) for lon, lat in ring] for ring in rings]

    xs = [x for ring in flat_rings for x, _ in ring]
    ys = [y for ring in flat_rings for _, y in ring]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 0.05)
    span_y = max(max_y - min_y, 0.05)

    scale = min((width - 2 * margin) / span_x, (height - 2 * margin) / span_y)
    offset_x = (width - span_x * scale) / 2 - min_x * scale
    offset_y = (height + span_y * scale) / 2 + min_y * scale

    paths: list[list[float]] = []
    for ring in flat_rings:
        coords: list[float] = []
        for x, y in ring:
            coords.extend([offset_x + x * scale, offset_y - y * scale])
        if len(coords) >= 4:
            paths.append(coords)
    return paths


class CountryOutlineGame(tk.Tk):
    def __init__(self, countries: list[Country], seed: int | None = None):
        super().__init__()
        self.title("Country Outline Guessing Game")
        self.minsize(920, 720)
        self.configure(bg="#f3f6f8")

        self.countries = countries
        self.alias_index = build_alias_index(countries)
        self.random = random.Random(seed)
        self.current: Country | None = None
        self.used_recent: list[str] = []
        self.guesses_left = 5
        self.score = 0
        self.rounds = 0
        self.round_over = False
        self.guessed: set[str] = set()

        self.status_var = tk.StringVar()
        self.guess_var = tk.StringVar()
        self.score_var = tk.StringVar()
        self.feedback_var = tk.StringVar()

        self._build_ui()
        self.bind("<Return>", lambda _event: self.submit_guess())
        self.canvas.bind("<Configure>", lambda _event: self.draw_current_country())
        self.new_round()

    def _build_ui(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TButton", font=("Segoe UI", 11), padding=8)
        style.configure("TEntry", font=("Segoe UI", 13), padding=8)
        style.configure("TLabel", background="#f3f6f8", foreground="#1f2933", font=("Segoe UI", 11))

        header = ttk.Frame(self, padding=(18, 14, 18, 8))
        header.pack(fill="x")
        header.columnconfigure(0, weight=1)

        title = ttk.Label(header, text="Guess the country from its outline", font=("Segoe UI", 18, "bold"))
        title.grid(row=0, column=0, sticky="w")
        score = ttk.Label(header, textvariable=self.score_var, font=("Segoe UI", 11, "bold"))
        score.grid(row=0, column=1, sticky="e")

        status = ttk.Label(header, textvariable=self.status_var)
        status.grid(row=1, column=0, columnspan=2, sticky="w", pady=(4, 0))

        self.canvas = tk.Canvas(self, bg="#ffffff", highlightthickness=1, highlightbackground="#c7d0da")
        self.canvas.pack(fill="both", expand=True, padx=18, pady=(4, 10))

        controls = ttk.Frame(self, padding=(18, 0, 18, 16))
        controls.pack(fill="x")
        controls.columnconfigure(0, weight=1)

        self.entry = ttk.Entry(controls, textvariable=self.guess_var)
        self.entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        self.entry.focus_set()

        ttk.Button(controls, text="Guess", command=self.submit_guess).grid(row=0, column=1, padx=(0, 8))
        ttk.Button(controls, text="Skip", command=self.skip_round).grid(row=0, column=2, padx=(0, 8))
        ttk.Button(controls, text="Next outline", command=self.new_round).grid(row=0, column=3)

        feedback = ttk.Label(controls, textvariable=self.feedback_var, font=("Segoe UI", 11))
        feedback.grid(row=1, column=0, columnspan=4, sticky="w", pady=(10, 0))

    def choose_country(self) -> Country:
        pool = [country for country in self.countries if country.name not in self.used_recent]
        if not pool:
            self.used_recent.clear()
            pool = self.countries[:]
        country = self.random.choice(pool)
        self.used_recent.append(country.name)
        self.used_recent = self.used_recent[-30:]
        return country

    def new_round(self) -> None:
        self.current = self.choose_country()
        self.guesses_left = 5
        self.round_over = False
        self.guessed.clear()
        self.guess_var.set("")
        self.feedback_var.set("Type a country name. You have 5 guesses.")
        self.status_var.set("Guess 1 of 5")
        self.update_score()
        self.draw_current_country()
        self.entry.focus_set()

    def update_score(self) -> None:
        self.score_var.set(f"Score: {self.score}/{self.rounds}")

    def draw_current_country(self) -> None:
        if self.current is None:
            return
        width = max(self.canvas.winfo_width(), 2)
        height = max(self.canvas.winfo_height(), 2)
        self.canvas.delete("all")
        self.canvas.create_rectangle(0, 0, width, height, fill="#ffffff", outline="")
        for path in canvas_paths(self.current, width, height):
            self.canvas.create_line(path, fill="#111827", width=3, capstyle="round", joinstyle="round")

    def resolve_guess(self, raw_guess: str) -> Country | None:
        return self.alias_index.get(normalize_name(raw_guess))

    def guess_suggestions(self, raw_guess: str) -> str:
        normalized = normalize_name(raw_guess)
        options = list(self.alias_index.keys())
        matches = get_close_matches(normalized, options, n=3, cutoff=0.78)
        names = []
        for match in matches:
            country = self.alias_index[match]
            if country.name not in names:
                names.append(country.name)
        return ", ".join(names)

    def submit_guess(self) -> None:
        if self.current is None or self.round_over:
            return

        raw_guess = self.guess_var.get().strip()
        if not raw_guess:
            self.feedback_var.set("Type a country name first.")
            return

        guessed_country = self.resolve_guess(raw_guess)
        if guessed_country is None:
            suggestions = self.guess_suggestions(raw_guess)
            if suggestions:
                self.feedback_var.set(f"I do not recognize that country. Did you mean: {suggestions}?")
            else:
                self.feedback_var.set("I do not recognize that country. Try another spelling.")
            return

        if guessed_country.name in self.guessed:
            self.feedback_var.set(f"You already guessed {guessed_country.name}. Try a different country.")
            self.guess_var.set("")
            return

        self.guessed.add(guessed_country.name)

        if guessed_country.name == self.current.name:
            self.score += 1
            self.rounds += 1
            self.round_over = True
            self.feedback_var.set(f"Correct. It was {self.current.name}.")
            self.status_var.set("Solved. Press Next outline.")
            self.update_score()
            self.guess_var.set("")
            return

        self.guesses_left -= 1
        distance = haversine_km(guessed_country.lon, guessed_country.lat, self.current.lon, self.current.lat)
        distance_text = f"{distance:,.0f} km"

        if self.guesses_left <= 0:
            self.rounds += 1
            self.round_over = True
            self.feedback_var.set(
                f"{guessed_country.name} is {distance_text} away. Out of guesses: {self.current.name}."
            )
            self.status_var.set("Round over. Press Next outline.")
            self.update_score()
        else:
            guess_number = 6 - self.guesses_left
            self.feedback_var.set(
                f"{guessed_country.name} is {distance_text} away. {self.guesses_left} guesses left."
            )
            self.status_var.set(f"Guess {guess_number} of 5")
        self.guess_var.set("")

    def skip_round(self) -> None:
        if self.current is None or self.round_over:
            return
        self.rounds += 1
        self.round_over = True
        self.feedback_var.set(f"Skipped. It was {self.current.name}.")
        self.status_var.set("Round over. Press Next outline.")
        self.update_score()
        self.guess_var.set("")


def self_test() -> int:
    countries = load_countries()
    aliases = build_alias_index(countries)
    required = ["United States of America", "United Kingdom", "China", "Israel", "Czechia"]
    names = {country.name for country in countries}
    missing = [name for name in required if name not in names]
    if missing:
        print(f"Missing required countries: {missing}", file=sys.stderr)
        return 1
    if len(countries) < 180:
        print(f"Too few countries loaded: {len(countries)}", file=sys.stderr)
        return 1
    for alias in ["usa", "uk", "china", "czech republic"]:
        if normalize_name(alias) not in aliases:
            print(f"Alias did not resolve: {alias}", file=sys.stderr)
            return 1
    usa = aliases[normalize_name("usa")]
    france = aliases[normalize_name("france")]
    distance = haversine_km(usa.lon, usa.lat, france.lon, france.lat)
    if not 6000 <= distance <= 9000:
        print(f"Unexpected USA-France distance: {distance}", file=sys.stderr)
        return 1
    sample_paths = canvas_paths(france, 900, 600)
    if not sample_paths:
        print("No drawable paths produced for France", file=sys.stderr)
        return 1
    print(f"Self-test passed. Loaded {len(countries)} country outlines.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Guess countries from outline-only Natural Earth shapes.")
    parser.add_argument("--seed", type=int, default=None, help="Optional random seed.")
    parser.add_argument("--list-countries", action="store_true", help="Print the country list and exit.")
    parser.add_argument("--self-test", action="store_true", help="Run a non-GUI smoke test and exit.")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    countries = load_countries()
    if args.list_countries:
        for country in countries:
            print(country.name)
        return 0

    app = CountryOutlineGame(countries, seed=args.seed)
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
