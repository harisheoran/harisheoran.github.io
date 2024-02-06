current_dir="."

cd ./content/about || exit

about_file="./../../content/about/index.md"

readme_data=$(curl -sL "https://raw.githubusercontent.com/harisheoran/harisheoran/main/README.md")

# Set the marker after which to append the readme data
marker="description: \"\""

#Check if the marker exists in about.md
if grep -q "$marker" "$about_file"; then
    # Append readme data after the marker in about.md using awk
    awk -v data="$readme_data" "/$marker/{p=1;print;next} p && !NF{p=0} !p" "$about_file" > "$about_file.tmp" && mv "$about_file.tmp" "$about_file"
    echo "Readme data added to $about_file after \"$marker\""
else
    echo "Marker \"$marker\" not found in $about_file"
fi

cd "$current_dir" || exit