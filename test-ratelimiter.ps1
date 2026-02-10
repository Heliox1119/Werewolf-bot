# Script pour tester le rate limiter
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "    TEST DU RATE LIMITER" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Lancer les tests
npm test -- tests/utils/rateLimiter.test.js
