# R-PROFILE-GAP — crates/store/src/lib.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/store/src/lib.rs:L1936–L2015`  
**File SHA-256:** `4110cba684bfb5401d6e7af4cf45a4190aebe6d39b25e77155a88b6a35f3a59b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

ensure_actor accepts caller identity/role inputs; create_work stores an empty profile definition and placeholder-derived digest.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1936,2015p' 'crates/store/src/lib.rs'
```

## Exact baseline excerpt

````text
 1936 |     pub fn ensure_actor(
 1937 |         &self,
 1938 |         actor_id: &str,
 1939 |         role: &str,
 1940 |         credential_ref: &str,
 1941 |         display_name: &str,
 1942 |         now: &str,
 1943 |     ) -> Result<(), StoreError> {
 1944 |         let mut statement = self.prepare(
 1945 |             "INSERT INTO actor (actor_id, role, credential_ref, display_name, created_at)
 1946 |              VALUES (?1, ?2, ?3, ?4, ?5)
 1947 |              ON CONFLICT(actor_id) DO NOTHING",
 1948 |         )?;
 1949 |         statement.bind_text(1, actor_id)?;
 1950 |         statement.bind_text(2, role)?;
 1951 |         statement.bind_text(3, credential_ref)?;
 1952 |         statement.bind_text(4, display_name)?;
 1953 |         statement.bind_text(5, now)?;
 1954 |         statement.run()
 1955 |     }
 1956 | 
 1957 |     pub fn ensure_acceptance_profile(
 1958 |         &self,
 1959 |         profile_id: &str,
 1960 |         version: u64,
 1961 |         policy_digest: &str,
 1962 |         definition_json: &str,
 1963 |         now: &str,
 1964 |     ) -> Result<(), StoreError> {
 1965 |         let mut statement = self.prepare(
 1966 |             "INSERT INTO acceptance_profile
 1967 |              (profile_id, version, policy_digest, definition_json, created_at)
 1968 |              VALUES (?1, ?2, ?3, ?4, ?5)
 1969 |              ON CONFLICT(profile_id, version) DO NOTHING",
 1970 |         )?;
 1971 |         statement.bind_text(1, profile_id)?;
 1972 |         statement.bind_i64(2, version)?;
 1973 |         statement.bind_text(3, policy_digest)?;
 1974 |         statement.bind_text(4, definition_json)?;
 1975 |         statement.bind_text(5, now)?;
 1976 |         statement.run()
 1977 |     }
 1978 | 
 1979 |     pub fn create_work(&self, work: &WorkItem, now: &str) -> Result<(), StoreError> {
 1980 |         self.execute_batch("BEGIN IMMEDIATE")?;
 1981 |         let result = self.create_work_in_transaction(work, now);
 1982 |         finish_transaction(self, result)
 1983 |     }
 1984 | 
 1985 |     fn create_work_in_transaction(&self, work: &WorkItem, now: &str) -> Result<(), StoreError> {
 1986 |         let profile_version = profile_version(&work.acceptance_profile.version)?;
 1987 |         self.ensure_acceptance_profile(
 1988 |             work.acceptance_profile.id.as_str(),
 1989 |             profile_version,
 1990 |             &format!("sha256:{}", work.acceptance_profile.id),
 1991 |             "{}",
 1992 |             now,
 1993 |         )?;
 1994 |         let mut statement = self.prepare(
 1995 |             "INSERT INTO work_item
 1996 |              (work_id, project_id, kind, parent_id, lifecycle, dispatch_policy,
 1997 |               priority, acceptance_profile_id, acceptance_profile_version, title, description,
 1998 |               created_at, updated_at)
 1999 |              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
 2000 |         )?;
 2001 |         statement.bind_text(1, work.id.as_str())?;
 2002 |         statement.bind_text(2, work.project_id.as_str())?;
 2003 |         statement.bind_text(3, work_kind(work.kind))?;
 2004 |         statement.bind_optional_text(4, work.parent_id.as_ref().map(WorkId::as_str))?;
 2005 |         statement.bind_text(5, lifecycle(work.lifecycle))?;
 2006 |         statement.bind_text(6, dispatch_policy(work.dispatch_policy))?;
 2007 |         statement.bind_i64(7, u64::from(work.priority))?;
 2008 |         statement.bind_text(8, work.acceptance_profile.id.as_str())?;
 2009 |         statement.bind_i64(9, profile_version)?;
 2010 |         statement.bind_text(10, &work.title)?;
 2011 |         statement.bind_text(11, &work.description)?;
 2012 |         statement.bind_text(12, now)?;
 2013 |         statement.run()?;
 2014 | 
 2015 |         for (index, hold) in work.hard_holds.iter().enumerate() {
````
