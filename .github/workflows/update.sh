current_dir="."

cd ./content/about || exit

file_path="./index.md"

data='---
title: "About"
date: 2023-11-11T20:54:47+01:00
draft: false
description: ""
---
'

if [ -f "$file_path" ]; then
    # File exists, so delete it
    rm "$file_path"
    echo "File deleted: $file_path"
    touch $file_path
    echo "$data" >> "$file_path"
else
    touch $file_path
    echo "$data" >> "$file_path"
fi

about_file=$file_path

readme_data=$(curl -sL "https://raw.githubusercontent.com/harisheoran/harisheoran/main/README.md")


# Set the marker after which to append the readme data
marker="description: \"\""

#Check if the marker exists in about.md
if grep -q "$marker" "$about_file"; then
    # Append readme data after the marker in about.md using awk
    # Replace content after the marker in about.md with readme data
    awk -v data="$readme_data" "/$marker/{print;print data;next}1" "$about_file" > "$about_file.tmp" && mv "$about_file.tmp" "$about_file"
    echo "Readme data added to $about_file after \"$marker\""
else
    echo "Marker \"$marker\" not found in $about_file"
fi

cd "$current_dir" || exit