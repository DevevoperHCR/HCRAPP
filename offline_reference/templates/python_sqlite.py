import sqlite3
con=sqlite3.connect("app.db")
con.execute("CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY,name TEXT NOT NULL)")
con.execute("INSERT INTO items(name) VALUES(?)",("Example",))
con.commit()
print(con.execute("SELECT * FROM items").fetchall())
con.close()
