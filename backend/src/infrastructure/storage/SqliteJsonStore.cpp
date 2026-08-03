#include "SqliteJsonStore.h"
#include <sqlite3.h>
#include <stdexcept>
#include <vector>
#include "infrastructure/storage/JsonIo.h"

namespace infrastructure::storage
{
namespace
{
std::string compact(const Json::Value &v) { Json::StreamWriterBuilder b; b["indentation"]=""; return Json::writeString(b,v); }

std::string escapeLikePattern(const std::string &value)
{
    std::string escaped;
    escaped.reserve(value.size());
    for (const auto ch : value)
    {
        if (ch == '\\' || ch == '%' || ch == '_') escaped.push_back('\\');
        escaped.push_back(ch);
    }
    return escaped;
}
}
SqliteJsonStore::SqliteJsonStore(const std::filesystem::path &path)
{
    std::filesystem::create_directories(path.parent_path());
    if (sqlite3_open_v2(path.string().c_str(), &db_, SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE|SQLITE_OPEN_FULLMUTEX, nullptr) != SQLITE_OK)
        throw std::runtime_error("Cannot open SQLite store: " + path.string());
    exec("PRAGMA journal_mode=WAL;"); exec("PRAGMA synchronous=NORMAL;"); exec("PRAGMA busy_timeout=5000;");
    exec("CREATE TABLE IF NOT EXISTS json_entities(namespace TEXT NOT NULL, entity_key TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT(unixepoch()), PRIMARY KEY(namespace,entity_key));");
    exec("CREATE INDEX IF NOT EXISTS idx_json_entities_namespace_updated ON json_entities(namespace,updated_at DESC);");
    exec("CREATE INDEX IF NOT EXISTS idx_json_entities_audit_action ON json_entities(namespace,json_extract(payload,'$.action'));");
    exec("CREATE INDEX IF NOT EXISTS idx_json_entities_audit_actor ON json_entities(namespace,json_extract(payload,'$.actor_user_id'));");
    exec("CREATE INDEX IF NOT EXISTS idx_json_entities_audit_org_time ON json_entities(namespace,json_extract(payload,'$.org_id'),json_extract(payload,'$.created_at') DESC);");
    exec("CREATE INDEX IF NOT EXISTS idx_json_entities_membership_scope ON json_entities(namespace,json_extract(payload,'$.scope_id'));");
}
SqliteJsonStore::~SqliteJsonStore(){ if(db_) sqlite3_close(db_); }
void SqliteJsonStore::exec(const char *sql) const { char *err=nullptr; if(sqlite3_exec(db_,sql,nullptr,nullptr,&err)!=SQLITE_OK){ std::string m=err?err:"SQLite error"; sqlite3_free(err); throw std::runtime_error(m); } }
void SqliteJsonStore::upsert(const std::string &ns,const std::string &key,const Json::Value &payload)
{
    std::scoped_lock lock(mutex_); sqlite3_stmt *s=nullptr; sqlite3_prepare_v2(db_,"INSERT INTO json_entities(namespace,entity_key,payload,updated_at) VALUES(?,?,?,unixepoch()) ON CONFLICT(namespace,entity_key) DO UPDATE SET payload=excluded.payload,updated_at=unixepoch()",-1,&s,nullptr);
    const auto raw=compact(payload); sqlite3_bind_text(s,1,ns.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(s,2,key.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(s,3,raw.c_str(),-1,SQLITE_TRANSIENT);
    if(sqlite3_step(s)!=SQLITE_DONE){ sqlite3_finalize(s); throw std::runtime_error(sqlite3_errmsg(db_)); } sqlite3_finalize(s);
}
Json::Value SqliteJsonStore::get(const std::string &ns,const std::string &key) const
{
    std::scoped_lock lock(mutex_); sqlite3_stmt *s=nullptr; sqlite3_prepare_v2(db_,"SELECT payload FROM json_entities WHERE namespace=? AND entity_key=?",-1,&s,nullptr); sqlite3_bind_text(s,1,ns.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(s,2,key.c_str(),-1,SQLITE_TRANSIENT); Json::Value out(Json::nullValue); if(sqlite3_step(s)==SQLITE_ROW) out=parseJson(reinterpret_cast<const char*>(sqlite3_column_text(s,0)),"sqlite"); sqlite3_finalize(s); return out;
}
Json::Value SqliteJsonStore::list(const std::string &ns,int limit,int offset) const
{
    std::scoped_lock lock(mutex_); sqlite3_stmt *s=nullptr; const char *sql=limit>0?"SELECT payload FROM json_entities WHERE namespace=? ORDER BY updated_at DESC,rowid DESC LIMIT ? OFFSET ?":"SELECT payload FROM json_entities WHERE namespace=? ORDER BY rowid"; sqlite3_prepare_v2(db_,sql,-1,&s,nullptr); sqlite3_bind_text(s,1,ns.c_str(),-1,SQLITE_TRANSIENT); if(limit>0){sqlite3_bind_int(s,2,limit);sqlite3_bind_int(s,3,offset);} Json::Value out(Json::arrayValue); while(sqlite3_step(s)==SQLITE_ROW) out.append(parseJson(reinterpret_cast<const char*>(sqlite3_column_text(s,0)),"sqlite")); sqlite3_finalize(s); return out;
}
Json::Value SqliteJsonStore::searchText(const std::string &ns,
                                        const std::string &jsonPath,
                                        const std::string &query,
                                        int limit) const
{
    std::scoped_lock lock(mutex_);
    sqlite3_stmt *stmt=nullptr;
    const char *sql =
        "WITH searchable AS ("
        " SELECT payload, lower(COALESCE(CAST(json_extract(payload, ?) AS TEXT), '')) AS search_value"
        " FROM json_entities WHERE namespace=?"
        ")"
        " SELECT payload FROM searchable"
        " WHERE search_value LIKE ? ESCAPE '\\'"
        " ORDER BY CASE"
        " WHEN search_value=? THEN 0"
        " WHEN search_value LIKE ? ESCAPE '\\' THEN 1"
        " ELSE 2 END, search_value"
        " LIMIT ?";
    if(sqlite3_prepare_v2(db_,sql,-1,&stmt,nullptr)!=SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db_));
    const auto escaped=escapeLikePattern(query);
    const auto containsPattern="%" + escaped + "%";
    const auto prefixPattern=escaped + "%";
    sqlite3_bind_text(stmt,1,jsonPath.c_str(),-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt,2,ns.c_str(),-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt,3,containsPattern.c_str(),-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt,4,query.c_str(),-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt,5,prefixPattern.c_str(),-1,SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt,6,(std::max)(1,limit));
    Json::Value out(Json::arrayValue);
    while(sqlite3_step(stmt)==SQLITE_ROW) out.append(parseJson(reinterpret_cast<const char*>(sqlite3_column_text(stmt,0)),"sqlite"));
    sqlite3_finalize(stmt);
    return out;
}
Json::Value SqliteJsonStore::queryAudit(const std::string &ns,
                                        const std::optional<std::string> &orgId,
                                        const std::optional<std::string> &actorId,
                                        const std::optional<std::string> &action,
                                        const std::optional<std::string> &actionPrefix,
                                        const std::optional<std::string> &since,
                                        const std::optional<std::string> &until,
                                        int limit,int offset,std::size_t &total) const
{
    std::scoped_lock lock(mutex_);
    std::string where=" WHERE namespace=?"; std::vector<std::string> values{ns};
    const auto add=[&](const char *expression,const std::optional<std::string> &value,const char *op="=") { if(!value)return; where += " AND "; where += expression; where += op; where += "?"; values.push_back(*value); };
    add("json_extract(payload,'$.org_id')",orgId);
    add("json_extract(payload,'$.actor_user_id')",actorId);
    add("json_extract(payload,'$.action')",action);
    if(actionPrefix)
    {
        where += " AND json_extract(payload,'$.action') GLOB ?";
        values.push_back(*actionPrefix + "*");
    }
    add("json_extract(payload,'$.created_at')",since,">=");
    add("json_extract(payload,'$.created_at')",until,"<");
    const auto bind=[&](sqlite3_stmt *stmt) { for(std::size_t i=0;i<values.size();++i) sqlite3_bind_text(stmt,static_cast<int>(i+1),values[i].c_str(),-1,SQLITE_TRANSIENT); };
    sqlite3_stmt *countStmt=nullptr; const auto countSql="SELECT count(*) FROM json_entities"+where;
    if(sqlite3_prepare_v2(db_,countSql.c_str(),-1,&countStmt,nullptr)!=SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db_));
    bind(countStmt); total=sqlite3_step(countStmt)==SQLITE_ROW?static_cast<std::size_t>(sqlite3_column_int64(countStmt,0)):0; sqlite3_finalize(countStmt);
    const auto querySql="SELECT payload FROM json_entities"+where+" ORDER BY json_extract(payload,'$.created_at') DESC, rowid DESC LIMIT ? OFFSET ?";
    sqlite3_stmt *stmt=nullptr; if(sqlite3_prepare_v2(db_,querySql.c_str(),-1,&stmt,nullptr)!=SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db_));
    bind(stmt); sqlite3_bind_int(stmt,static_cast<int>(values.size()+1),limit); sqlite3_bind_int(stmt,static_cast<int>(values.size()+2),offset);
    Json::Value out(Json::arrayValue); while(sqlite3_step(stmt)==SQLITE_ROW) out.append(parseJson(reinterpret_cast<const char*>(sqlite3_column_text(stmt,0)),"sqlite")); sqlite3_finalize(stmt); return out;
}
void SqliteJsonStore::replace(const std::string &ns,const Json::Value &items,const std::string &keyField)
{
    std::scoped_lock lock(mutex_); exec("BEGIN IMMEDIATE;"); try { sqlite3_stmt *d=nullptr; sqlite3_prepare_v2(db_,"DELETE FROM json_entities WHERE namespace=?",-1,&d,nullptr); sqlite3_bind_text(d,1,ns.c_str(),-1,SQLITE_TRANSIENT); sqlite3_step(d); sqlite3_finalize(d); sqlite3_stmt *s=nullptr; sqlite3_prepare_v2(db_,"INSERT INTO json_entities(namespace,entity_key,payload,updated_at) VALUES(?,?,?,unixepoch())",-1,&s,nullptr); int index=0; for(const auto &item:items){ const auto key=item.get(keyField,std::to_string(index++)).asString(); const auto raw=compact(item); sqlite3_bind_text(s,1,ns.c_str(),-1,SQLITE_TRANSIENT);sqlite3_bind_text(s,2,key.c_str(),-1,SQLITE_TRANSIENT);sqlite3_bind_text(s,3,raw.c_str(),-1,SQLITE_TRANSIENT); if(sqlite3_step(s)!=SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db_)); sqlite3_reset(s);sqlite3_clear_bindings(s);} sqlite3_finalize(s); exec("COMMIT;"); } catch(...){ exec("ROLLBACK;"); throw; }
}
std::size_t SqliteJsonStore::count(const std::string &ns) const { std::scoped_lock lock(mutex_); sqlite3_stmt*s=nullptr;sqlite3_prepare_v2(db_,"SELECT count(*) FROM json_entities WHERE namespace=?",-1,&s,nullptr);sqlite3_bind_text(s,1,ns.c_str(),-1,SQLITE_TRANSIENT);std::size_t n=sqlite3_step(s)==SQLITE_ROW?static_cast<std::size_t>(sqlite3_column_int64(s,0)):0;sqlite3_finalize(s);return n; }
std::unordered_map<std::string, int> SqliteJsonStore::groupCount(const std::string &ns,const std::string &jsonPath) const
{
    std::scoped_lock lock(mutex_); sqlite3_stmt *s=nullptr;
    const char *sql="SELECT json_extract(payload,?),count(*) FROM json_entities WHERE namespace=? GROUP BY json_extract(payload,?)";
    if(sqlite3_prepare_v2(db_,sql,-1,&s,nullptr)!=SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db_));
    sqlite3_bind_text(s,1,jsonPath.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(s,2,ns.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(s,3,jsonPath.c_str(),-1,SQLITE_TRANSIENT);
    std::unordered_map<std::string,int> out;
    while(sqlite3_step(s)==SQLITE_ROW){ const auto *raw=sqlite3_column_text(s,0); if(raw) out[reinterpret_cast<const char*>(raw)]=sqlite3_column_int(s,1); }
    sqlite3_finalize(s); return out;
}
bool SqliteJsonStore::erase(const std::string &ns,const std::string &key){std::scoped_lock lock(mutex_);sqlite3_stmt*s=nullptr;sqlite3_prepare_v2(db_,"DELETE FROM json_entities WHERE namespace=? AND entity_key=?",-1,&s,nullptr);sqlite3_bind_text(s,1,ns.c_str(),-1,SQLITE_TRANSIENT);sqlite3_bind_text(s,2,key.c_str(),-1,SQLITE_TRANSIENT);sqlite3_step(s);const bool changed=sqlite3_changes(db_)>0;sqlite3_finalize(s);return changed;}
void SqliteJsonStore::checkpoint() const { std::scoped_lock lock(mutex_); exec("PRAGMA wal_checkpoint(PASSIVE);"); }
}
