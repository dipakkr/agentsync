// Minimal glob matching for file-scope overlap detection.
// Supports **, *, ? — enough for task scopes like "src/auth/**" or "**/schema.*".

/** Convert a glob to a RegExp anchored at both ends. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** matches across path separators (and an optional trailing slash)
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*"; // * stays within a path segment
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

/** Does a concrete file path match a glob? */
export function matchFile(glob, file) {
  return globToRegExp(glob).test(file);
}

/** Static prefix of a glob — the part before the first wildcard. */
function staticPrefix(glob) {
  const i = glob.search(/[*?[{]/);
  const head = i === -1 ? glob : glob.slice(0, i);
  return head.slice(0, head.lastIndexOf("/") + 1); // keep up to last complete segment
}

/**
 * Advisory overlap test between two glob scopes. Returns true if the two sets of
 * globs could plausibly touch the same file. Conservative on purpose: a false warn
 * costs a chat message; a missed overlap costs a merge conflict.
 */
export function scopesOverlap(scopeA, scopeB) {
  for (const a of scopeA) {
    for (const b of scopeB) {
      const pa = staticPrefix(a);
      const pb = staticPrefix(b);
      // Nested static prefixes (one contains the other) → potential overlap.
      if (pa.startsWith(pb) || pb.startsWith(pa)) {
        // If both have concrete tails, require the wildcard side to actually match.
        if (!a.includes("*") && !a.includes("?")) {
          if (matchFile(b, a)) return true;
        } else if (!b.includes("*") && !b.includes("?")) {
          if (matchFile(a, b)) return true;
        } else {
          return true; // both wildcarded and prefixes nest → warn
        }
      }
    }
  }
  return false;
}

/** Which of `files` fall inside any glob of `scope`. */
export function filesInScope(files, scope) {
  return files.filter((f) => scope.some((g) => matchFile(g, f)));
}
