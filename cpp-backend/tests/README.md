# Test Suite

## C++ smoke test

```bash
ctest --test-dir cpp-backend/build --output-on-failure
```

## Contract test (API envelope/schema)

```bash
python cpp-backend/tests/contract_v2_smoke.py
```

## Integration flow test

```bash
python cpp-backend/tests/integration_flow_smoke.py
```

## Perf baseline

```bash
python cpp-backend/tests/perf_read_score.py
```
