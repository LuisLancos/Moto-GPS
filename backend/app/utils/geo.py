"""Shared geospatial utilities."""

import math


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in meters between two lat/lon points."""
    R = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = p2 - p1
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def haversine_m_lnglat(p1: list[float], p2: list[float]) -> float:
    """Haversine distance in meters. Points are [lng, lat]."""
    return haversine_m(p1[1], p1[0], p2[1], p2[0])


def bearing(p1: list[float], p2: list[float]) -> float:
    """Bearing in degrees (0-360) from p1 to p2. Points are [lng, lat]."""
    lat1, lat2 = math.radians(p1[1]), math.radians(p2[1])
    dlon = math.radians(p2[0] - p1[0])
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return math.degrees(math.atan2(x, y)) % 360


def angular_diff(a: float, b: float) -> float:
    """Smallest angular difference in degrees (0-180)."""
    d = abs(a - b) % 360
    return d if d <= 180 else 360 - d
