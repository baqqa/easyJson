use serde_json::Value;

pub fn build_context_snippets(
    root: &Value,
    question: &str,
    current_path: &[String],
    max_snippets: usize,
) -> Vec<String> {
    let mut out = Vec::new();
    let q = question.to_lowercase();

    if !current_path.is_empty() {
        out.push(format!("Current path: Home > {}", current_path.join(" > ")));
    } else {
        out.push("Current path: Home".to_string());
    }

    if let Value::Object(map) = root {
        let keys: Vec<&String> = map.keys().collect();
        out.push(format!(
            "Top-level keys ({}): {}",
            keys.len(),
            keys.iter()
                .take(20)
                .map(|k| k.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    // Lightweight retrieval: find first matching key/value paths
    let mut hits = Vec::new();
    collect_hits(root, &mut Vec::new(), &q, &mut hits, max_snippets);
    out.extend(hits);

    out
}

fn collect_hits(
    node: &Value,
    path: &mut Vec<String>,
    q: &str,
    out: &mut Vec<String>,
    limit: usize,
) {
    if out.len() >= limit {
        return;
    }

    match node {
        Value::Object(map) => {
            for (k, v) in map {
                path.push(k.clone());
                if k.to_lowercase().contains(q) && out.len() < limit {
                    out.push(format!("Key match at Home > {}", path.join(" > ")));
                }
                collect_hits(v, path, q, out, limit);
                path.pop();
                if out.len() >= limit {
                    return;
                }
            }
        }
        Value::Array(items) => {
            for (i, v) in items.iter().enumerate() {
                path.push(format!("[{}]", i));
                collect_hits(v, path, q, out, limit);
                path.pop();
                if out.len() >= limit {
                    return;
                }
            }
        }
        Value::String(s) => {
            if s.to_lowercase().contains(q) && out.len() < limit {
                out.push(format!("Value match at Home > {}", path.join(" > ")));
            }
        }
        Value::Number(n) => {
            if n.to_string().to_lowercase().contains(q) && out.len() < limit {
                out.push(format!("Value match at Home > {}", path.join(" > ")));
            }
        }
        Value::Bool(b) => {
            if b.to_string().to_lowercase().contains(q) && out.len() < limit {
                out.push(format!("Value match at Home > {}", path.join(" > ")));
            }
        }
        Value::Null => {
            if "null".contains(q) && out.len() < limit {
                out.push(format!("Value match at Home > {}", path.join(" > ")));
            }
        }
    }
}
