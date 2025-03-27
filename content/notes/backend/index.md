# 

# Building backend services in Go

## Connecting to the Database

- Need Database driver to translate the commands frm Go to SQL commands.

- Create the Database connection pool, this is an
  important diﬀerence to understand. Go manages these connections as
  needed, automatically opening and closing connections to the
  database via the driver.



## Understanding the Database

- Table have row and column

- Column specifies the type of data like Name, age, email

- Row specfies a single record in the table.

- Primary Key: Unique Identifier

- Foriegn Key: A column that links one table to another by referencing a primary key.
  
  

## Designing Database interaction

- Create another directory to store database related code like models and related function, we'll use this directory as a library.
  
  - The pkg directory is being used to hold ancillary non-
    application-specific code, which could potentially be reused. A database
    model which could be used by other applications in the future (like a
    command line interface application) fits the bill here

- **pkg/models/models.go**  contains the database model

- **pkg/models/postgres/<ops>.go** contain methods to execute commands on database like INSERT, DELETE, etc.