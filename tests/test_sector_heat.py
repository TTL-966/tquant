"""Smoke test for SectorHeatCalculator."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.db import Database
from backend.sector_heat import SectorHeatCalculator


def test_concept_heat_returns_list():
    db = Database()
    calc = SectorHeatCalculator(db.engine)
    result = calc.compute('concept', 'heat_score', days=5)
    assert isinstance(result, list), f"Expected list, got {type(result)}"
    print(f"Concept sectors: {len(result)}")
    if result:
        first = result[0]
        assert 'name' in first
        assert 'avg_change_pct' in first
        assert 'heat_score' in first
        print(f"Top concept: {first['name']} (score={first['heat_score']})")


def test_industry_heat_returns_list():
    db = Database()
    calc = SectorHeatCalculator(db.engine)
    result = calc.compute('industry', 'change_pct', days=5)
    assert isinstance(result, list), f"Expected list, got {type(result)}"
    print(f"Industry sectors: {len(result)}")
    if result:
        print(f"Top industry: {result[0]['name']} (change={result[0]['avg_change_pct']}%)")


def test_sector_detail_returns_stocks():
    db = Database()
    calc = SectorHeatCalculator(db.engine)
    sectors = calc.compute('concept', 'heat_score', days=5)
    if sectors:
        top_name = sectors[0]['name']
        detail = calc.get_sector_detail('concept', top_name)
        assert 'name' in detail
        assert 'stocks' in detail
        assert isinstance(detail['stocks'], list)
        print(f"Sector '{top_name}' detail: {len(detail['stocks'])} stocks")


if __name__ == "__main__":
    test_concept_heat_returns_list()
    test_industry_heat_returns_list()
    test_sector_detail_returns_stocks()
    print("All tests passed!")
