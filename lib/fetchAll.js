// Supabase sends back at most 1,000 rows per request (the project's
// "max rows" setting). Real client ledgers have far more lines than that,
// so this asks for the rows page by page until there are none left.
//
// makeQuery must build a fresh, fully ordered query each time it's called,
// for example:
//   fetchAll(() => supabase.from('journal_entries').select('*').eq('engagement_id', id).order('id'))
// Returns { data, error } like a normal Supabase call.

export async function fetchAll(makeQuery, pageSize = 1000) {
  let all = [];
  for (;;) {
    const { data, error } = await makeQuery().range(all.length, all.length + pageSize - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) return { data: all, error: null };
    all = all.concat(data);
  }
}
