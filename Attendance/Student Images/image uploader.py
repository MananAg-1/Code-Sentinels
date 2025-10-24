import os
import base64
import requests
import json

# === CONFIG ===
# Folder structure: dataset_path/Class/Section/StudentName/images
dataset_path = r"C:\Users\LENOVO\Downloads\hackathon-pvt-main\hackathon-pvt-main\IMAGE DATASET"  # e.g., "C:/Dataset" or "/path/to/Dataset"
SERVER_URL = "http://localhost:8080"

print("=" * 70)
print(" Enhanced Upload Script - Class & Section Support")
print("=" * 70)

def parse_folder_structure():
    """
    Parse folder structure to extract class, section, and student data
    Expected structure:
    dataset_path/
        Class10/
            A/
                John_Doe/
                    image1.jpg
                    image2.jpg
            B/
                Jane_Smith/
                    image1.jpg
    """
    
    print(f"\n[INFO] Scanning dataset folder: {dataset_path}")
    print("[INFO] Expected structure: Class/Section/StudentName/images")
    
    people_data = []
    
    # Iterate through class folders
    for class_folder in os.listdir(dataset_path):
        class_path = os.path.join(dataset_path, class_folder)
        
        if not os.path.isdir(class_path):
            continue
        
        # Extract class name (e.g., "Class10" -> "10")
        class_name = class_folder.replace('Class', '').replace('class', '')
        
        print(f"\n[CLASS] Processing {class_name}...")
        
        # Iterate through section folders
        for section_folder in os.listdir(class_path):
            section_path = os.path.join(class_path, section_folder)
            
            if not os.path.isdir(section_path):
                continue
            
            section_name = section_folder
            
            print(f"  [SECTION] {section_name}")
            
            # Iterate through student folders
            for student_folder in os.listdir(section_path):
                student_path = os.path.join(section_path, student_folder)
                
                if not os.path.isdir(student_path):
                    continue
                
                # Extract student name and optional roll number
                # Format: "John_Doe" or "John_Doe_01" (roll number)
                parts = student_folder.split('_')
                if len(parts) >= 2 and parts[-1].isdigit():
                    student_name = '_'.join(parts[:-1]).replace('_', ' ')
                    roll_number = parts[-1]
                else:
                    student_name = student_folder.replace('_', ' ')
                    roll_number = None
                
                images_base64 = []
                
                print(f"    [STUDENT] {student_name}", end='')
                if roll_number:
                    print(f" (Roll: {roll_number})", end='')
                print()
                
                # Load all images for this student
                for img_name in os.listdir(student_path):
                    if not img_name.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.tiff')):
                        continue
                    
                    img_path = os.path.join(student_path, img_name)
                    
                    try:
                        with open(img_path, 'rb') as img_file:
                            img_bytes = img_file.read()
                            img_base64 = base64.b64encode(img_bytes).decode('utf-8')
                            images_base64.append(img_base64)
                            print(f"      ✓ {img_name}")
                    except Exception as e:
                        print(f"      ✗ Error reading {img_name}: {e}")
                
                if images_base64:
                    people_data.append({
                        'name': student_name,
                        'class': class_name,
                        'section': section_name,
                        'roll_number': roll_number,
                        'images': images_base64
                    })
                    print(f"      → Total: {len(images_base64)} images")
    
    return people_data

def upload_dataset(people_data):
    """Upload people data with class/section to server"""
    
    if not people_data:
        print("\n[ERROR] No data found to upload!")
        return
    
    print(f"\n[INFO] Uploading {len(people_data)} students to server...")
    print("[INFO] Registering people with class/section information...")
    
    success_count = 0
    error_count = 0
    
    for person in people_data:
        try:
            # Step 1: Register person with class/section
            register_response = requests.post(
                f"{SERVER_URL}/api/face/register_person",
                json={
                    'name': person['name'],
                    'class': person['class'],
                    'section': person['section'],
                    'roll_number': person['roll_number']
                },
                timeout=10
            )
            
            if register_response.status_code not in [200, 201]:
                print(f"  ✗ Failed to register {person['name']}")
                error_count += 1
                continue
            
            person_id = register_response.json()['person_id']
            
            # Step 2: Upload images for this person
            images_uploaded = 0
            for img_base64 in person['images']:
                try:
                    img_response = requests.post(
                        f"{SERVER_URL}/api/face/add_image",
                        json={
                            'person_id': person_id,
                            'image_data': img_base64
                        },
                        timeout=10
                    )
                    
                    if img_response.status_code in [200, 201]:
                        images_uploaded += 1
                except:
                    pass
            
            print(f"  ✓ {person['name']} ({person['class']}-{person['section']}) - {images_uploaded} images")
            success_count += 1
            
        except Exception as e:
            print(f"  ✗ Error uploading {person['name']}: {e}")
            error_count += 1
    
    print(f"\n[SUMMARY]")
    print(f"  ✓ Success: {success_count} students")
    print(f"  ✗ Errors: {error_count} students")

def upload_simple_structure():
    """
    Upload from simple structure (backward compatibility)
    dataset_path/StudentName/images
    """
    print("\n[INFO] Using simple folder structure (no class/section)")
    
    people_data = []
    
    for person_folder in os.listdir(dataset_path):
        person_path = os.path.join(dataset_path, person_folder)
        
        if not os.path.isdir(person_path):
            continue
        
        person_name = person_folder.replace('_', ' ')
        images_base64 = []
        
        print(f"\n[INFO] Processing {person_name}...")
        
        for img_name in os.listdir(person_path):
            if not img_name.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.tiff')):
                continue
            
            img_path = os.path.join(person_path, img_name)
            
            try:
                with open(img_path, 'rb') as img_file:
                    img_bytes = img_file.read()
                    img_base64 = base64.b64encode(img_bytes).decode('utf-8')
                    images_base64.append(img_base64)
                    print(f"  ✓ {img_name}")
            except Exception as e:
                print(f"  ✗ Error reading {img_name}: {e}")
        
        if images_base64:
            people_data.append({
                'name': person_name,
                'images': images_base64
            })
            print(f"  → Total: {len(images_base64)} images")
    
    return people_data

def detect_structure():
    """Detect whether dataset uses class/section structure or simple structure"""
    
    # Check if any subdirectory has further subdirectories
    for item in os.listdir(dataset_path):
        item_path = os.path.join(dataset_path, item)
        if os.path.isdir(item_path):
            subdirs = [d for d in os.listdir(item_path) if os.path.isdir(os.path.join(item_path, d))]
            if len(subdirs) > 0:
                # Check if subdirs also have subdirs (Class/Section/Student structure)
                for subdir in subdirs[:1]:  # Check first subdir
                    subdir_path = os.path.join(item_path, subdir)
                    subsubdirs = [d for d in os.listdir(subdir_path) if os.path.isdir(os.path.join(subdir_path, d))]
                    if len(subsubdirs) > 0:
                        return 'hierarchical'
            return 'simple'
    return 'simple'

if __name__ == "__main__":
    print("\n[INFO] This script will upload images with class/section information")
    print(f"[INFO] Dataset path: {dataset_path}")
    
    # Check if dataset path exists
    if not os.path.exists(dataset_path):
        print(f"\n[ERROR] Dataset path not found: {dataset_path}")
        print("Please update the 'dataset_path' variable in the script")
        exit(1)
    
    # Check server connection
    try:
        response = requests.get(f"{SERVER_URL}/health", timeout=3)
        print(f"[INFO] ✓ Server is reachable at {SERVER_URL}")
    except:
        print(f"\n[ERROR] Cannot connect to server at {SERVER_URL}")
        print("Please make sure the server is running (node server.js)")
        exit(1)
    
    # Detect folder structure
    structure = detect_structure()
    
    print(f"\n[INFO] Detected folder structure: {structure.upper()}")
    
    if structure == 'hierarchical':
        print("[INFO] Structure: Class/Section/StudentName/images")
        print("[INFO] This will upload with class and section information")
    else:
        print("[INFO] Structure: StudentName/images")
        print("[INFO] This will upload without class/section (can be added later)")
    
    # Ask for confirmation
    input("\nPress ENTER to start upload (or Ctrl+C to cancel)...")
    
    # Parse and upload based on structure
    if structure == 'hierarchical':
        people_data = parse_folder_structure()
        if people_data:
            upload_dataset(people_data)
    else:
        people_data = upload_simple_structure()
        if people_data:
            # Use bulk upload endpoint
            try:
                response = requests.post(
                    f"{SERVER_URL}/api/face/upload_dataset",
                    json={'people_data': people_data},
                    timeout=60
                )
                
                if response.status_code == 200:
                    data = response.json()
                    print(f"\n[SUCCESS] ✓ Upload complete!")
                    print(f"  → People: {data.get('people_count')}")
                    print(f"  → Images: {data.get('image_count')}")
                else:
                    print(f"\n[ERROR] Upload failed: {response.status_code}")
            except Exception as e:
                print(f"\n[ERROR] Upload failed: {e}")
    
    print("\n[INFO] Done! You can now:")
    print("  1. Run the face recognition system (ONYX.py)")
    print("  2. View attendance in the teacher dashboard")
    print("  3. Filter by class and section")
    print("=" * 70)