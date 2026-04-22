# Sink UserRepository.h into UserRepository.{h,cpp}
# - Reads the original 1306-line header
# - Writes a slim header with declarations only (templates remain in header)
# - Writes a .cpp with all method bodies, qualified with UserRepository::
$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$headerPath = Join-Path $root 'cpp-backend\src\infrastructure\storage\UserRepository.h'
$cppPath    = Join-Path $root 'cpp-backend\src\infrastructure\storage\UserRepository.cpp'

$utf8 = New-Object System.Text.UTF8Encoding($false)
$content = [System.IO.File]::ReadAllText($headerPath, $utf8)
$lines = $content -split "`r?`n"

# --- Detect first line of class body and last line of class body ---
$classOpenIdx = $null
for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match '^class UserRepository') { $classOpenIdx = $i; break }
}
if ($null -eq $classOpenIdx) { throw "class UserRepository not found" }

# Find namespace closing brace (last `}  // namespace`)
$nsCloseIdx = $null
for ($i = $lines.Length - 1; $i -ge 0; $i--) {
    if ($lines[$i] -match '^\}\s*//\s*namespace') { $nsCloseIdx = $i; break }
}
if ($null -eq $nsCloseIdx) { throw "namespace close not found" }

# Class close: the `};` two lines before namespace close (last `};` before nsCloseIdx)
$classCloseIdx = $null
for ($i = $nsCloseIdx - 1; $i -ge $classOpenIdx; $i--) {
    if ($lines[$i] -match '^\};\s*$') { $classCloseIdx = $i; break }
}
if ($null -eq $classCloseIdx) { throw "class close `};` not found" }

# Find member declaration block start: `private:` followed by `std::filesystem::path userRootDir_`
$membersStartIdx = $null
for ($i = $classCloseIdx; $i -ge $classOpenIdx; $i--) {
    if ($lines[$i] -match 'std::filesystem::path\s+userRootDir_') {
        # walk back to nearest `private:`
        for ($j = $i; $j -ge $classOpenIdx; $j--) {
            if ($lines[$j] -match '^\s*private:\s*$') { $membersStartIdx = $j; break }
        }
        break
    }
}
if ($null -eq $membersStartIdx) { throw "members start (private: + userRootDir_) not found" }

# --- Build slim header: keep lines 0..(classOpenIdx) intact, then class decl-only, then `};` and namespace close ---

$slimHeaderLines = @(
'#pragma once',
'',
'#include <filesystem>',
'#include <shared_mutex>',
'#include <string>',
'',
'#include <drogon/utils/Utilities.h>',
'#include <json/json.h>',
'',
'#include "WalStore.h"',
'',
'namespace infrastructure::storage',
'{',
'class UserRepository',
'{',
'  public:',
'    explicit UserRepository(std::filesystem::path userRootDir);',
'',
'    void ensureBaseline();',
'',
'    Json::Value users() const;',
'    Json::Value roles() const;',
'',
'    Json::Value findUserByUsername(const std::string &username) const;',
'    Json::Value findUserByEmail(const std::string &email) const;',
'    Json::Value findUserByLoginId(const std::string &loginId) const;',
'    Json::Value findUserById(const std::string &userId) const;',
'    Json::Value findUserByPhone(const std::string &phone) const;',
'    Json::Value findUserByOpenid(const std::string &openid) const;',
'    Json::Value findUserByReferralCode(const std::string &referralCode) const;',
'',
'    Json::Value usersByRole(const std::string &roleId) const;',
'',
'    Json::Value createUser(const std::string &username,',
'                           const std::string &password,',
'                           const std::string &email,',
'                           const std::string &referralCode = "");',
'',
'    Json::Value createDevelopmentUser(const std::string &loginId);',
'',
'    bool verifyPassword(const Json::Value &user, const std::string &password) const;',
'',
'    Json::Value bindPhone(const std::string &userId, const std::string &phone);',
'    Json::Value bindEmail(const std::string &userId, const std::string &email);',
'',
'    Json::Value createPhoneUser(const std::string &phone, const std::string &referralCode = "");',
'',
'    Json::Value claimReferral(const std::string &userId, const std::string &referralCode);',
'',
'    bool grantReferralRewardIfPending(const std::string &userId,',
'                                      const std::string &trigger,',
'                                      int rewardCredits = 0,',
'                                      const std::string &rewardRecipientUserId = "");',
'',
'    Json::Value upsertWechatUser(const std::string &openid,',
'                                 const std::string &nickname,',
'                                 const std::string &avatarUrl,',
'                                 const std::string &loginIdHint = "");',
'',
'    static std::string hashPassword(const std::string &password)',
'    {',
'        return drogon::utils::getSha256(password);',
'    }',
'',
'  private:',
'    static Json::Value defaultRolesMap();',
'    static Json::Value normalizeUser(const Json::Value &input);',
'    static std::string normalizeReferralCode(std::string referralCode);',
'    static std::string normalizeReferralRewardStatus(const std::string &status);',
'    static Json::Value findUserByReferralCodeUnlocked(const Json::Value &usersJson,',
'                                                      const std::string &referralCode);',
'    static std::string generateReferralCode(const Json::Value &usersJson, const std::string &seed);',
'    static std::string buildReferralPrefix(const std::string &seed);',
'    static std::string legacyReferralCode(const std::string &userId, const std::string &username);',
'    static Json::Value mergeRoleDefinition(const Json::Value &baseline,',
'                                           const Json::Value &incoming,',
'                                           const std::string &roleId);',
'    static Json::Value normalizeRolesArray(const Json::Value &roles);',
'    static void appendUniqueStrings(Json::Value &target, const Json::Value &values);',
'    static void appendUniqueRole(Json::Value &target, const std::string &role);',
'    static std::string normalizeRoleId(const std::string &roleId);',
'    static std::string normalizeStatus(const std::string &status);',
'    static std::string normalizeScopeType(const std::string &scopeType);',
'    static std::string normalizeOrganizationType(const std::string &organizationType,',
'                                                 const std::string &scopeType);',
'    static bool containsUsername(const Json::Value &usersJson, const std::string &username);',
'    static bool matchesLoginId(const Json::Value &user, const std::string &loginId);',
'    static std::string uniqueStorageKey(const Json::Value &usersJson, const std::string &base);',
'    static std::string uniqueUsernameForBase(const Json::Value &usersJson, const std::string &base);',
'    static std::string nextPersonalMemberNo(const Json::Value &usersJson);',
'    static Json::Value developmentRolesForLoginId(const std::string &loginId);',
'    static std::string padSerial(int value, int width);',
'    static std::string sanitizeIdentifier(const std::string &value);',
'    static std::string sanitizePhone(const std::string &phone);',
'    static int extractPrefixedSerial(const std::string &value, const std::string &prefix);',
'    static std::string generateUserId();',
'',
'    template <typename Func>',
'    static void forEachUserValue(const Json::Value &usersJson, Func visitor)',
'    {',
'        if (usersJson.isArray())',
'        {',
'            for (const auto &entry : usersJson)',
'            {',
'                if (entry.isObject())',
'                {',
'                    visitor(entry);',
'                }',
'            }',
'            return;',
'        }',
'        if (!usersJson.isObject())',
'        {',
'            return;',
'        }',
'        for (const auto &name : usersJson.getMemberNames())',
'        {',
'            const auto &entry = usersJson[name];',
'            if (name == "users" && entry.isArray())',
'            {',
'                for (const auto &legacyEntry : entry)',
'                {',
'                    if (legacyEntry.isObject())',
'                    {',
'                        visitor(legacyEntry);',
'                    }',
'                }',
'                continue;',
'            }',
'            if (entry.isObject())',
'            {',
'                visitor(entry);',
'            }',
'        }',
'    }',
'',
'    template <typename Func>',
'    static void forEachUserValue(Json::Value &usersJson, Func visitor)',
'    {',
'        if (usersJson.isArray())',
'        {',
'            for (auto &entry : usersJson)',
'            {',
'                if (entry.isObject())',
'                {',
'                    visitor(entry);',
'                }',
'            }',
'            return;',
'        }',
'        if (!usersJson.isObject())',
'        {',
'            return;',
'        }',
'        for (const auto &name : usersJson.getMemberNames())',
'        {',
'            auto &entry = usersJson[name];',
'            if (name == "users" && entry.isArray())',
'            {',
'                for (auto &legacyEntry : entry)',
'                {',
'                    if (legacyEntry.isObject())',
'                    {',
'                        visitor(legacyEntry);',
'                    }',
'                }',
'                continue;',
'            }',
'            if (entry.isObject())',
'            {',
'                visitor(entry);',
'            }',
'        }',
'    }',
'',
'    std::filesystem::path userRootDir_;',
'    std::filesystem::path usersFile_;',
'    std::filesystem::path rolesFile_;',
'    mutable std::shared_mutex mutex_;',
'    WalStore wal_;',
'    std::size_t recoveredEvents_{0};',
'};',
'}  // namespace infrastructure::storage',
''
)

# --- Build .cpp by extracting class body, qualifying methods ---
# We'll process the original lines from `public:` to just before `private:` member declarations,
# extracting top-level (8-space-indented) member function definitions.

# Identify region: between classOpenIdx+2 (after `{`) and membersStartIdx-1 (before final private members)
# Each member function starts at depth 1 inside the class. Indent of member declarations = 4 spaces ("    ").
# Body opens with `    {` and closes at matching `    }` line.

$bodyStart = $classOpenIdx + 2  # after `{` line
$bodyEnd   = $membersStartIdx - 1  # exclusive of `private:`/members section

# Walk the lines, capturing each function definition block.
# A function definition in the original is: signature lines (indented 4 spaces) + body block opening with `    {` and closing with `    }`.
# We capture from the first signature line until the matching closing brace.

$cppParts = New-Object System.Collections.Generic.List[string]
$null = $cppParts.Add('// Auto-generated by tools/sink_user_repository.ps1 from UserRepository.h')
$null = $cppParts.Add('#include "UserRepository.h"')
$null = $cppParts.Add('')
$null = $cppParts.Add('#include <algorithm>')
$null = $cppParts.Add('#include <cctype>')
$null = $cppParts.Add('#include <chrono>')
$null = $cppParts.Add('#include <random>')
$null = $cppParts.Add('#include <string>')
$null = $cppParts.Add('')
$null = $cppParts.Add('#include <drogon/HttpTypes.h>')
$null = $cppParts.Add('')
$null = $cppParts.Add('#include "JsonIo.h"')
$null = $cppParts.Add('#include "common/AppException.h"')
$null = $cppParts.Add('#include "common/IdGenerator.h"')
$null = $cppParts.Add('#include "common/TimeUtils.h"')
$null = $cppParts.Add('')
$null = $cppParts.Add('namespace infrastructure::storage')
$null = $cppParts.Add('{')
$null = $cppParts.Add('')

# Signature regex: starts with 4 spaces, not a section label, not a template, not a member field decl
# We'll grab signature lines until line == "    {", then take through matching "    }"
$i = $bodyStart
while ($i -le $bodyEnd) {
    $line = $lines[$i]
    if ($line -match '^\s*$') { $i++; continue }
    if ($line -match '^\s*//') {
        # comment line — include as-is at file scope (rare)
        $null = $cppParts.Add($line)
        $i++
        continue
    }
    if ($line -match '^\s*(public|private|protected):\s*$') { $i++; continue }
    if ($line -match '^\s*template\s*<') {
        # Skip the entire template (which is in the header). Find its closing `    }` at indent 4.
        # Walk past signature to opening `    {`
        while ($i -le $bodyEnd -and $lines[$i] -notmatch '^\s{4}\{\s*$') { $i++ }
        # Walk to closing `    }`
        $i++
        while ($i -le $bodyEnd -and $lines[$i] -notmatch '^\s{4}\}\s*$') { $i++ }
        $i++  # past `}`
        continue
    }
    # Constructor pattern: `    explicit UserRepository(...)` followed by `        : ... { ... }`
    # In this file ctor uses initializer list: lines until `{` line
    # Generic function pattern: collect signature lines until line is exactly `    {`
    if ($line -match '^\s{4}\S' -and $line -notmatch ';\s*$') {
        # Capture signature
        $sigStart = $i
        while ($i -le $bodyEnd -and $lines[$i] -notmatch '^\s{4,8}\{\s*$') { $i++ }
        if ($i -gt $bodyEnd) { break }
        $sigLines = $lines[$sigStart..($i-1)]
        $openBraceLine = $lines[$i]
        # Now find matching `    }` at indent 4
        $bodyStart2 = $i + 1
        $j = $bodyStart2
        while ($j -le $bodyEnd -and $lines[$j] -notmatch '^\s{4}\}\s*$') { $j++ }
        if ($j -gt $bodyEnd) { break }
        $bodyLines = $lines[$bodyStart2..($j-1)]

        # Skip member functions kept inline in header: hashPassword
        $isHashPassword = $false
        foreach ($s in $sigLines) {
            if ($s -match 'hashPassword\s*\(') { $isHashPassword = $true; break }
        }
        if ($isHashPassword) {
            $i = $j + 1
            continue
        }

        # Qualify the function name with UserRepository::
        # Find the first sig line that contains '(' — that's the line with function name
        $sigQualified = New-Object System.Collections.Generic.List[string]
        $nameQualified = $false
        foreach ($s in $sigLines) {
            if (-not $nameQualified -and $s -match '\(') {
                # Match function name: word char sequence immediately before the first '('
                # Allow modifiers like static, explicit, return type
                # We replace the LAST identifier before '(' with UserRepository::<name>
                $regex = '([A-Za-z_][A-Za-z0-9_]*)\s*\('
                $m = [regex]::Match($s, $regex)
                if ($m.Success) {
                    $fnName = $m.Groups[1].Value
                    # Strip leading 4-space indent
                    $stripped = $s -replace '^\s{4}', ''
                    # Remove `static ` and `explicit ` prefixes since they don't appear in out-of-class definitions
                    $stripped = $stripped -replace '^static\s+', ''
                    $stripped = $stripped -replace '^explicit\s+', ''
                    # Replace fnName( with UserRepository::fnName(
                    $stripped = [regex]::Replace($stripped, "(?<![A-Za-z0-9_:])$fnName\s*\(", "UserRepository::$fnName(", 1)
                    # Remove default argument values like ` = ""` or ` = 0` (not allowed in out-of-class definitions)
                    $stripped = [regex]::Replace($stripped, '\s*=\s*"[^"]*"', '')
                    $stripped = [regex]::Replace($stripped, '\s*=\s*0(?=[,)])', '')
                    $null = $sigQualified.Add($stripped)
                    $nameQualified = $true
                    continue
                }
            }
            # Strip 4-space indent for continuation lines too; also strip default args
            $stripped2 = $s -replace '^\s{4}', ''
            $stripped2 = [regex]::Replace($stripped2, '\s*=\s*"[^"]*"', '')
            $stripped2 = [regex]::Replace($stripped2, '\s*=\s*0(?=[,)])', '')
            $null = $sigQualified.Add($stripped2)
        }

        foreach ($s in $sigQualified) { $null = $cppParts.Add($s) }
        $null = $cppParts.Add('{')
        # Strip 4-space indent from body lines (they were at 8+ spaces inside class)
        foreach ($b in $bodyLines) {
            if ($b -match '^\s{4}(.*)$') {
                $null = $cppParts.Add($Matches[1])
            } else {
                $null = $cppParts.Add($b)
            }
        }
        $null = $cppParts.Add('}')
        $null = $cppParts.Add('')

        $i = $j + 1
        continue
    }
    # Otherwise skip (e.g. trailing junk)
    $i++
}

$null = $cppParts.Add('}  // namespace infrastructure::storage')
$null = $cppParts.Add('')

# Write outputs
[System.IO.File]::WriteAllText($headerPath, ($slimHeaderLines -join "`r`n"), $utf8)
[System.IO.File]::WriteAllText($cppPath, ($cppParts -join "`r`n"), $utf8)

Write-Host ("Header lines: {0}" -f $slimHeaderLines.Count)
Write-Host ("Cpp lines:    {0}" -f $cppParts.Count)
