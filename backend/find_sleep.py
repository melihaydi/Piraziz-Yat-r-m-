import os

def find_sleep():
    for root, dirs, files in os.walk("."):
        for f in files:
            if f.endswith(".py") and f != "find_sleep.py":
                path = os.path.join(root, f)
                try:
                    with open(path, "r", encoding="utf-8") as file:
                        content = file.read()
                        if "sleep(" in content:
                            print(f"Found sleep in {path}:")
                            for line in content.split("\n"):
                                if "sleep(" in line:
                                    print("  ", line.strip())
                except Exception:
                    pass

find_sleep()
